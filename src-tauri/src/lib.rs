use chrono::Utc;
use keyring::Entry;
use serde::{Deserialize, Serialize};
use std::{env, path::PathBuf, sync::Arc};
use tauri::{AppHandle, Manager, State};
use tokio::sync::Mutex;
use turso::{params, Connection};
use uuid::Uuid;

mod accounting_core;
mod accounting_persistence;
mod sales_core;
mod sales_bridge;

enum DbBackend {
    Local(turso::Database),
    Synced(turso::sync::Database),
}

#[derive(Clone)]
pub(crate) struct AppDb {
    db: Arc<Mutex<DbBackend>>,
}

#[derive(Debug, Serialize)]
struct Product { sku: String, name: String, category: String, cost: f64, price: f64, stock: f64, min_stock: f64 }

#[derive(Debug, Serialize)]
struct TopProduct { name: String, sold_qty: f64, revenue: f64, profit: f64, margin: f64 }

#[derive(Debug, Serialize)]
struct DashboardSummary {
    stock_value: f64,
    today_sales: f64,
    gross_profit: f64,
    cash_balance: f64,
    low_stock: i64,
    receivables: f64,
    top_products: Vec<TopProduct>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct SaleItem { pub sku: String, pub qty: f64, pub unit_price: f64 }

#[derive(Debug, Deserialize)]
pub(crate) struct SaleInput { pub items: Vec<SaleItem>, pub payment_method: String }

#[derive(Debug, Deserialize)] struct ProductInput { sku: String, name: String, category: String, cost: f64, price: f64, stock: f64, min_stock: f64 }
#[derive(Debug, Deserialize)] struct ExpenseInput { category: String, description: String, amount: f64, account: String }
#[derive(Debug, Deserialize)] struct PurchaseInput { supplier: String, sku: String, qty: f64, unit_cost: f64, account: String }
#[derive(Debug, Deserialize)] struct CategoryInput { name: String }
#[derive(Debug, Deserialize)] struct IncomeInput { category: String, description: String, amount: f64, account: String }
#[derive(Debug, Deserialize)] struct CustomerInput {
    #[serde(default)] id: Option<i64>,
    name: String,
    #[serde(default)] phone: String,
    #[serde(default)] email: String,
    #[serde(default)] credit_limit: f64,
}
#[derive(Debug, Deserialize)] struct CustomerPaymentInput { customer_id: i64, amount: f64, #[serde(default = "default_cash")] account: String }
#[derive(Debug, Deserialize)] struct SupplierInput { name: String, #[serde(default)] phone: String, #[serde(default)] email: String, #[serde(default)] address: String }
#[derive(Debug, Deserialize)] struct SessionInput { access_token: String, user_id: String, company_id: String, company_name: String, role: String, expires_at: String }

fn default_cash() -> String { "Cash".to_string() }

pub(crate) async fn conn(state: &State<'_, AppDb>) -> Result<Connection, String> {
    let db = state.db.lock().await;
    match &*db {
        DbBackend::Local(db) => db.connect().map_err(|e| e.to_string()),
        DbBackend::Synced(db) => db.connect().await.map_err(|e| e.to_string()),
    }
}

fn keyring_value(name: &str) -> Option<String> {
    Entry::new("NATRA-Inventory-Cloud", name).ok().and_then(|e| e.get_password().ok()).filter(|v| !v.trim().is_empty())
}

fn cloud_credentials() -> (Option<String>, Option<String>) {
    let url = env::var("TURSO_DATABASE_URL").ok().filter(|v| !v.trim().is_empty()).or_else(|| keyring_value("database-url"));
    let token = env::var("TURSO_AUTH_TOKEN").ok().filter(|v| !v.trim().is_empty()).or_else(|| keyring_value("auth-token"));
    (url, token)
}

async fn init_schema(c: &Connection) -> Result<(), String> {
    c.execute_batch(r#"
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS categories (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT,sku TEXT NOT NULL UNIQUE,name TEXT NOT NULL,category TEXT NOT NULL DEFAULT 'General',cost REAL NOT NULL DEFAULT 0,price REAL NOT NULL DEFAULT 0,stock REAL NOT NULL DEFAULT 0,min_stock REAL NOT NULL DEFAULT 0,active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sales (id INTEGER PRIMARY KEY AUTOINCREMENT,reference TEXT NOT NULL UNIQUE,sale_date TEXT NOT NULL,subtotal REAL NOT NULL,discount REAL NOT NULL DEFAULT 0,revenue REAL NOT NULL,cogs REAL NOT NULL,profit REAL NOT NULL,payment_method TEXT NOT NULL DEFAULT 'Cash',status TEXT NOT NULL DEFAULT 'COMPLETED');
      CREATE TABLE IF NOT EXISTS sale_items (id INTEGER PRIMARY KEY AUTOINCREMENT,sale_id INTEGER NOT NULL REFERENCES sales(id),sku TEXT NOT NULL,qty REAL NOT NULL,unit_price REAL NOT NULL,unit_cost REAL NOT NULL,line_revenue REAL NOT NULL,line_cogs REAL NOT NULL,line_profit REAL NOT NULL);
      CREATE TABLE IF NOT EXISTS stock_movements (id INTEGER PRIMARY KEY AUTOINCREMENT,reference TEXT NOT NULL,sku TEXT NOT NULL,movement_type TEXT NOT NULL,qty_in REAL NOT NULL DEFAULT 0,qty_out REAL NOT NULL DEFAULT 0,balance_after REAL NOT NULL,unit_cost REAL NOT NULL DEFAULT 0,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS purchases (id INTEGER PRIMARY KEY AUTOINCREMENT,reference TEXT NOT NULL UNIQUE,supplier TEXT NOT NULL,purchase_date TEXT NOT NULL,total REAL NOT NULL,status TEXT NOT NULL DEFAULT 'RECEIVED');
      CREATE TABLE IF NOT EXISTS expenses (id INTEGER PRIMARY KEY AUTOINCREMENT,reference TEXT NOT NULL UNIQUE,category TEXT NOT NULL,description TEXT NOT NULL,amount REAL NOT NULL,expense_date TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS customers (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,phone TEXT,email TEXT,credit_limit REAL NOT NULL DEFAULT 0,balance REAL NOT NULL DEFAULT 0,active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS customer_payments (id INTEGER PRIMARY KEY AUTOINCREMENT,reference TEXT NOT NULL UNIQUE,customer_id INTEGER NOT NULL REFERENCES customers(id),amount REAL NOT NULL,account TEXT NOT NULL DEFAULT 'Cash',payment_date TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS cash_transactions (id INTEGER PRIMARY KEY AUTOINCREMENT,reference TEXT NOT NULL UNIQUE,tx_type TEXT NOT NULL,description TEXT NOT NULL,amount REAL NOT NULL,account TEXT NOT NULL DEFAULT 'Cash',created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sale_customers (sale_id INTEGER PRIMARY KEY REFERENCES sales(id),customer_id INTEGER NOT NULL REFERENCES customers(id));
      CREATE TABLE IF NOT EXISTS suppliers (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,phone TEXT,email TEXT,address TEXT,active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT,actor TEXT NOT NULL,action TEXT NOT NULL,entity_type TEXT NOT NULL,entity_id TEXT,details TEXT,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sync_conflicts (id INTEGER PRIMARY KEY AUTOINCREMENT,entity_type TEXT NOT NULL,entity_id TEXT NOT NULL,local_json TEXT NOT NULL,remote_json TEXT,status TEXT NOT NULL DEFAULT 'OPEN',created_at TEXT NOT NULL,resolved_at TEXT);
      CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY,applied_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sync_outbox (id INTEGER PRIMARY KEY AUTOINCREMENT,entity_type TEXT NOT NULL,entity_id TEXT NOT NULL,operation TEXT NOT NULL CHECK(operation IN ('UPSERT','DELETE')),payload TEXT,created_at TEXT NOT NULL,synced_at TEXT);
      CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
      CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(sale_date);
      CREATE INDEX IF NOT EXISTS idx_stock_sku ON stock_movements(sku);
      CREATE INDEX IF NOT EXISTS idx_cash_date ON cash_transactions(created_at);
      CREATE INDEX IF NOT EXISTS idx_sync_outbox_pending ON sync_outbox(synced_at,id);
      CREATE TABLE IF NOT EXISTS app_session (id INTEGER PRIMARY KEY CHECK(id=1),access_token TEXT NOT NULL,user_id TEXT NOT NULL,company_id TEXT NOT NULL,company_name TEXT NOT NULL,role TEXT NOT NULL,expires_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    "#).await.map_err(|e| e.to_string())?;
    c.execute("INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(?1,?2)", params!["1.2.0", Utc::now().to_rfc3339()]).await.map_err(|e| e.to_string())?;
    Ok(())
}

async fn scalar_f64(c: &Connection, sql: &str) -> Result<f64, String> {
    let mut rows = c.query(sql, ()).await.map_err(|e| e.to_string())?;
    Ok(match rows.next().await.map_err(|e| e.to_string())? { Some(r) => r.get::<f64>(0).unwrap_or(0.0), None => 0.0 })
}
async fn scalar_i64(c: &Connection, sql: &str) -> Result<i64, String> {
    let mut rows = c.query(sql, ()).await.map_err(|e| e.to_string())?;
    Ok(match rows.next().await.map_err(|e| e.to_string())? { Some(r) => r.get::<i64>(0).unwrap_or(0), None => 0 })
}

#[tauri::command]
async fn list_categories(state: State<'_, AppDb>) -> Result<serde_json::Value, String> {
    let c=conn(&state).await?; let mut rows=c.query("SELECT id,name FROM categories ORDER BY name",()).await.map_err(|e|e.to_string())?; let mut out=Vec::new();
    while let Some(r)=rows.next().await.map_err(|e|e.to_string())? { out.push(serde_json::json!({"id":r.get::<i64>(0).unwrap_or(0),"name":r.get::<String>(1).unwrap_or_default()})); }
    Ok(serde_json::Value::Array(out))
}

#[tauri::command]
async fn create_category(state: State<'_, AppDb>, input: CategoryInput) -> Result<i64,String> { let name=input.name.trim(); if name.is_empty(){return Err("Category name is required".into());} let c=conn(&state).await?; c.execute("INSERT INTO categories(name,created_at) VALUES(?1,?2)",params![name,Utc::now().to_rfc3339()]).await.map_err(|e|e.to_string())?; Ok(c.last_insert_rowid()) }

#[tauri::command]
async fn list_products(state: State<'_, AppDb>) -> Result<Vec<Product>, String> { let c=conn(&state).await?; let mut rows=c.query("SELECT sku,name,category,cost,price,stock,min_stock FROM products WHERE active=1 ORDER BY name",()).await.map_err(|e|e.to_string())?; let mut out=Vec::new(); while let Some(r)=rows.next().await.map_err(|e|e.to_string())? { out.push(Product{sku:r.get(0).map_err(|e|e.to_string())?,name:r.get(1).map_err(|e|e.to_string())?,category:r.get(2).map_err(|e|e.to_string())?,cost:r.get(3).map_err(|e|e.to_string())?,price:r.get(4).map_err(|e|e.to_string())?,stock:r.get(5).map_err(|e|e.to_string())?,min_stock:r.get(6).map_err(|e|e.to_string())?}); } Ok(out) }

#[tauri::command]
async fn save_product(state: State<'_, AppDb>, input: ProductInput) -> Result<(), String> { if input.sku.trim().is_empty()||input.name.trim().is_empty(){return Err("SKU and product name are required".into());} if !input.cost.is_finite()||!input.price.is_finite()||!input.stock.is_finite()||!input.min_stock.is_finite()||input.cost<0.0||input.price<0.0||input.stock<0.0||input.min_stock<0.0{return Err("Product numeric values must be finite and non-negative".into());} let c=conn(&state).await?; let now=Utc::now().to_rfc3339(); c.execute("INSERT INTO products(sku,name,category,cost,price,stock,min_stock,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(sku) DO UPDATE SET name=excluded.name,category=excluded.category,cost=excluded.cost,price=excluded.price,stock=excluded.stock,min_stock=excluded.min_stock,updated_at=excluded.updated_at",params![input.sku.trim(),input.name.trim(),input.category.trim(),input.cost,input.price,input.stock,input.min_stock,now.clone(),now]).await.map_err(|e|e.to_string())?; Ok(()) }

#[tauri::command]
async fn delete_product(state: State<'_, AppDb>, sku: String) -> Result<(), String> { let c=conn(&state).await?; c.execute("UPDATE products SET active=0,updated_at=?1 WHERE sku=?2",params![Utc::now().to_rfc3339(),sku.trim()]).await.map_err(|e|e.to_string())?; Ok(()) }

#[tauri::command]
async fn record_income(state: State<'_, AppDb>, input: IncomeInput) -> Result<String,String> { if !input.amount.is_finite()||input.amount<=0.0||input.description.trim().is_empty(){return Err("Income amount and description are required".into());} let c=conn(&state).await?; let reference=format!("INC-{}",Uuid::new_v4().simple()); let now=Utc::now().to_rfc3339(); c.execute("INSERT INTO cash_transactions(reference,tx_type,description,amount,account,created_at) VALUES(?,?,?,?,?,?)",params![reference.clone(),"INCOME",format!("{}: {}",input.category.trim(),input.description.trim()),input.amount,input.account.trim(),now]).await.map_err(|e|e.to_string())?; Ok(reference) }

#[tauri::command]
async fn record_expense(state: State<'_, AppDb>, input: ExpenseInput) -> Result<String, String> { if !input.amount.is_finite()||input.amount<=0.0||input.description.trim().is_empty(){return Err("Expense amount and description are required".into());} let mut c=conn(&state).await?; let tx=c.transaction().await.map_err(|e|e.to_string())?; let now=Utc::now().to_rfc3339(); let reference=format!("EXP-{}",Uuid::new_v4().simple()); tx.execute("INSERT INTO expenses(reference,category,description,amount,expense_date) VALUES(?,?,?,?,?)",params![reference.clone(),input.category.trim(),input.description.trim(),input.amount,now.clone()]).await.map_err(|e|e.to_string())?; tx.execute("INSERT INTO cash_transactions(reference,tx_type,description,amount,account,created_at) VALUES(?,?,?,?,?,?)",params![reference.clone(),"EXPENSE",input.description.trim(),input.amount,input.account.trim(),now]).await.map_err(|e|e.to_string())?; tx.commit().await.map_err(|e|e.to_string())?; Ok(reference) }

#[tauri::command]
async fn record_purchase(state: State<'_, AppDb>, input: PurchaseInput) -> Result<String, String> { if input.qty<=0.0||!input.qty.is_finite()||input.unit_cost<0.0||!input.unit_cost.is_finite()||input.supplier.trim().is_empty()||input.sku.trim().is_empty(){return Err("Supplier, SKU, quantity and non-negative unit cost are required".into());} let mut c=conn(&state).await?; let mut lookup=c.query("SELECT stock,cost FROM products WHERE sku=?1 AND active=1",params![input.sku.trim()]).await.map_err(|e|e.to_string())?; let row=lookup.next().await.map_err(|e|e.to_string())?.ok_or_else(||"Product not found".to_string())?; let old_stock:f64=row.get(0).map_err(|e|e.to_string())?; let old_cost:f64=row.get(1).map_err(|e|e.to_string())?; drop(lookup); let new_stock=old_stock+input.qty; let total=input.qty*input.unit_cost; let new_cost=if new_stock>0.0{((old_stock*old_cost)+(input.qty*input.unit_cost))/new_stock}else{input.unit_cost}; let tx=c.transaction().await.map_err(|e|e.to_string())?; let now=Utc::now().to_rfc3339(); let reference=format!("PUR-{}",Uuid::new_v4().simple()); tx.execute("INSERT INTO purchases(reference,supplier,purchase_date,total) VALUES(?,?,?,?)",params![reference.clone(),input.supplier.trim(),now.clone(),total]).await.map_err(|e|e.to_string())?; tx.execute("UPDATE products SET stock=?1,cost=?2,updated_at=?3 WHERE sku=?4",params![new_stock,new_cost,now.clone(),input.sku.trim()]).await.map_err(|e|e.to_string())?; tx.execute("INSERT INTO stock_movements(reference,sku,movement_type,qty_in,balance_after,unit_cost,created_at) VALUES(?,?,?,?,?,?,?)",params![reference.clone(),input.sku.trim(),"PURCHASE",input.qty,new_stock,input.unit_cost,now.clone()]).await.map_err(|e|e.to_string())?; tx.execute("INSERT INTO cash_transactions(reference,tx_type,description,amount,account,created_at) VALUES(?,?,?,?,?,?)",params![reference.clone(),"PURCHASE","Inventory purchase",total,input.account.trim(),now]).await.map_err(|e|e.to_string())?; tx.commit().await.map_err(|e|e.to_string())?; Ok(reference) }

#[tauri::command]
async fn dashboard_summary(state: State<'_, AppDb>) -> Result<DashboardSummary, String> { let c=conn(&state).await?; let stock_value=scalar_f64(&c,"SELECT COALESCE(SUM(stock*cost),0) FROM products WHERE active=1").await?; let today_sales=scalar_f64(&c,"SELECT COALESCE(SUM(revenue),0) FROM sales WHERE date(sale_date)=date('now','localtime') AND status NOT IN ('VOID','CANCELLED')").await?; let gross_profit=scalar_f64(&c,"SELECT COALESCE(SUM(profit),0) FROM sales WHERE date(sale_date)=date('now','localtime') AND status NOT IN ('VOID','CANCELLED')").await?; let cash_in=scalar_f64(&c,"SELECT COALESCE(SUM(amount),0) FROM cash_transactions WHERE tx_type IN ('INCOME','SALE','PAYMENT') AND account!='Credit'").await?; let cash_out=scalar_f64(&c,"SELECT COALESCE(SUM(amount),0) FROM cash_transactions WHERE tx_type IN ('EXPENSE','PURCHASE')").await?; let low_stock=scalar_i64(&c,"SELECT COUNT(*) FROM products WHERE active=1 AND stock<=min_stock").await?; let receivables=scalar_f64(&c,"SELECT COALESCE(SUM(balance),0) FROM customers WHERE active=1").await?; let mut rows=c.query("SELECT p.name,COALESCE(SUM(si.qty),0),COALESCE(SUM(si.line_revenue),0),COALESCE(SUM(si.line_profit),0) FROM sale_items si JOIN products p ON p.sku=si.sku JOIN sales s ON s.id=si.sale_id WHERE s.status NOT IN ('VOID','CANCELLED') GROUP BY si.sku ORDER BY SUM(si.line_revenue) DESC LIMIT 5",()).await.map_err(|e|e.to_string())?; let mut top_products=Vec::new(); while let Some(r)=rows.next().await.map_err(|e|e.to_string())?{let revenue:f64=r.get(2).map_err(|e|e.to_string())?;let profit:f64=r.get(3).map_err(|e|e.to_string())?;top_products.push(TopProduct{name:r.get(0).map_err(|e|e.to_string())?,sold_qty:r.get(1).map_err(|e|e.to_string())?,revenue,profit,margin:if revenue>0.0{profit/revenue*100.0}else{0.0}});} Ok(DashboardSummary{stock_value,today_sales,gross_profit,cash_balance:cash_in-cash_out,low_stock,receivables,top_products}) }

#[tauri::command]
async fn report_summary(state: State<'_, AppDb>) -> Result<DashboardSummary,String> { dashboard_summary(state).await }

#[tauri::command]
async fn record_customer_payment(state: State<'_, AppDb>, input: CustomerPaymentInput) -> Result<String,String> { if input.customer_id<=0||!input.amount.is_finite()||input.amount<=0.0{return Err("Valid customer and payment amount are required".into());} let mut c=conn(&state).await?; let mut rows=c.query("SELECT balance FROM customers WHERE id=?1 AND active=1",params![input.customer_id]).await.map_err(|e|e.to_string())?; let row=rows.next().await.map_err(|e|e.to_string())?.ok_or_else(||"Customer not found".to_string())?; let balance:f64=row.get(0).map_err(|e|e.to_string())?; drop(rows); if input.amount>balance{return Err("Payment cannot exceed customer balance".into());} let tx=c.transaction().await.map_err(|e|e.to_string())?; let reference=format!("PAY-{}",Uuid::new_v4().simple()); let now=Utc::now().to_rfc3339(); tx.execute("INSERT INTO customer_payments(reference,customer_id,amount,account,payment_date) VALUES(?,?,?,?,?)",params![reference.clone(),input.customer_id,input.amount,input.account.trim(),now.clone()]).await.map_err(|e|e.to_string())?; tx.execute("UPDATE customers SET balance=balance-?1 WHERE id=?2",params![input.amount,input.customer_id]).await.map_err(|e|e.to_string())?; tx.execute("INSERT INTO cash_transactions(reference,tx_type,description,amount,account,created_at) VALUES(?,?,?,?,?,?)",params![reference.clone(),"PAYMENT","Customer payment",input.amount,input.account.trim(),now.clone()]).await.map_err(|e|e.to_string())?; tx.commit().await.map_err(|e|e.to_string())?; Ok(reference) }

#[tauri::command]
async fn list_customers(state: State<'_, AppDb>) -> Result<serde_json::Value,String> { let c=conn(&state).await?; let mut rows=c.query("SELECT id,name,phone,email,credit_limit,balance,active,created_at FROM customers ORDER BY name",()).await.map_err(|e|e.to_string())?; let mut out=Vec::new(); while let Some(r)=rows.next().await.map_err(|e|e.to_string())?{out.push(serde_json::json!({"id":r.get::<i64>(0).unwrap_or(0),"name":r.get::<String>(1).unwrap_or_default(),"phone":r.get::<String>(2).unwrap_or_default(),"email":r.get::<String>(3).unwrap_or_default(),"credit_limit":r.get::<f64>(4).unwrap_or(0.0),"balance":r.get::<f64>(5).unwrap_or(0.0),"active":r.get::<i64>(6).unwrap_or(0)!=0,"created_at":r.get::<String>(7).unwrap_or_default()}));} Ok(serde_json::Value::Array(out)) }

#[tauri::command]
async fn save_customer(state: State<'_, AppDb>, input: CustomerInput) -> Result<i64,String> { if input.name.trim().is_empty(){return Err("Customer name is required".into());} if !input.credit_limit.is_finite()||input.credit_limit<0.0{return Err("Credit limit must be non-negative".into());} let c=conn(&state).await?; let now=Utc::now().to_rfc3339(); if let Some(id)=input.id { c.execute("UPDATE customers SET name=?1,phone=?2,email=?3,credit_limit=?4 WHERE id=?5",params![input.name.trim(),input.phone.trim(),input.email.trim(),input.credit_limit,id]).await.map_err(|e|e.to_string())?; Ok(id) } else { c.execute("INSERT INTO customers(name,phone,email,credit_limit,created_at) VALUES(?,?,?,?,?)",params![input.name.trim(),input.phone.trim(),input.email.trim(),input.credit_limit,now]).await.map_err(|e|e.to_string())?; Ok(c.last_insert_rowid()) } }

#[tauri::command]
async fn list_transactions(state: State<'_, AppDb>) -> Result<serde_json::Value,String> { let c=conn(&state).await?; let mut rows=c.query("SELECT id,reference,tx_type,description,amount,account,created_at FROM cash_transactions ORDER BY created_at DESC LIMIT 1000",()).await.map_err(|e|e.to_string())?; let mut out=Vec::new(); while let Some(r)=rows.next().await.map_err(|e|e.to_string())?{out.push(serde_json::json!({"id":r.get::<i64>(0).unwrap_or(0),"reference":r.get::<String>(1).unwrap_or_default(),"tx_type":r.get::<String>(2).unwrap_or_default(),"description":r.get::<String>(3).unwrap_or_default(),"amount":r.get::<f64>(4).unwrap_or(0.0),"account":r.get::<String>(5).unwrap_or_default(),"created_at":r.get::<String>(6).unwrap_or_default()}));} Ok(serde_json::Value::Array(out)) }

#[tauri::command]
async fn list_suppliers(state: State<'_, AppDb>) -> Result<serde_json::Value,String> { let c=conn(&state).await?; let mut rows=c.query("SELECT id,name,phone,email,address,active,created_at,updated_at FROM suppliers WHERE active=1 ORDER BY name",()).await.map_err(|e|e.to_string())?; let mut out=Vec::new(); while let Some(r)=rows.next().await.map_err(|e|e.to_string())?{out.push(serde_json::json!({"id":r.get::<i64>(0).unwrap_or(0),"name":r.get::<String>(1).unwrap_or_default(),"phone":r.get::<String>(2).unwrap_or_default(),"email":r.get::<String>(3).unwrap_or_default(),"address":r.get::<String>(4).unwrap_or_default(),"active":r.get::<i64>(5).unwrap_or(0)!=0,"created_at":r.get::<String>(6).unwrap_or_default(),"updated_at":r.get::<String>(7).unwrap_or_default()}));} Ok(serde_json::Value::Array(out)) }

#[tauri::command]
async fn create_supplier(state: State<'_, AppDb>, input: SupplierInput) -> Result<i64,String> { if input.name.trim().is_empty(){return Err("Supplier name is required".into());} let c=conn(&state).await?; let now=Utc::now().to_rfc3339(); c.execute("INSERT INTO suppliers(name,phone,email,address,created_at,updated_at) VALUES(?,?,?,?,?,?)",params![input.name.trim(),input.phone.trim(),input.email.trim(),input.address.trim(),now.clone(),now]).await.map_err(|e|e.to_string())?; Ok(c.last_insert_rowid()) }

#[tauri::command]
async fn list_stock_movements(state: State<'_, AppDb>) -> Result<serde_json::Value,String> { let c=conn(&state).await?; let mut rows=c.query("SELECT reference,sku,movement_type,qty_in,qty_out,balance_after,unit_cost,created_at FROM stock_movements ORDER BY created_at DESC LIMIT 500",()).await.map_err(|e|e.to_string())?; let mut out=Vec::new(); while let Some(r)=rows.next().await.map_err(|e|e.to_string())?{out.push(serde_json::json!({"reference":r.get::<String>(0).unwrap_or_default(),"sku":r.get::<String>(1).unwrap_or_default(),"movement_type":r.get::<String>(2).unwrap_or_default(),"qty_in":r.get::<f64>(3).unwrap_or(0.0),"qty_out":r.get::<f64>(4).unwrap_or(0.0),"balance_after":r.get::<f64>(5).unwrap_or(0.0),"unit_cost":r.get::<f64>(6).unwrap_or(0.0),"created_at":r.get::<String>(7).unwrap_or_default()}));} Ok(serde_json::Value::Array(out)) }

#[tauri::command]
async fn list_sales_history(state: State<'_, AppDb>) -> Result<serde_json::Value,String> { let c=conn(&state).await?; let mut rows=c.query("SELECT reference,sale_date,revenue,cogs,profit,payment_method,status FROM sales ORDER BY sale_date DESC LIMIT 500",()).await.map_err(|e|e.to_string())?; let mut out=Vec::new(); while let Some(r)=rows.next().await.map_err(|e|e.to_string())?{out.push(serde_json::json!({"reference":r.get::<String>(0).unwrap_or_default(),"date":r.get::<String>(1).unwrap_or_default(),"revenue":r.get::<f64>(2).unwrap_or(0.0),"cogs":r.get::<f64>(3).unwrap_or(0.0),"profit":r.get::<f64>(4).unwrap_or(0.0),"payment_method":r.get::<String>(5).unwrap_or_default(),"status":r.get::<String>(6).unwrap_or_default()}));} Ok(serde_json::Value::Array(out)) }

#[tauri::command]
async fn list_purchase_history(state: State<'_, AppDb>) -> Result<serde_json::Value,String> { let c=conn(&state).await?; let mut rows=c.query("SELECT reference,supplier,purchase_date,total,status FROM purchases ORDER BY purchase_date DESC LIMIT 500",()).await.map_err(|e|e.to_string())?; let mut out=Vec::new(); while let Some(r)=rows.next().await.map_err(|e|e.to_string())?{out.push(serde_json::json!({"reference":r.get::<String>(0).unwrap_or_default(),"supplier":r.get::<String>(1).unwrap_or_default(),"date":r.get::<String>(2).unwrap_or_default(),"total":r.get::<f64>(3).unwrap_or(0.0),"status":r.get::<String>(4).unwrap_or_default()}));} Ok(serde_json::Value::Array(out)) }

fn sql_literal(v: turso::Value) -> String { match v { turso::Value::Null=>"NULL".into(), turso::Value::Integer(x)=>x.to_string(), turso::Value::Real(x)=>x.to_string(), turso::Value::Text(x)=>format!("'{}'",x.replace('\'',"''")), turso::Value::Blob(x)=>format!("X'{}'",x.iter().map(|b|format!("{b:02X}")).collect::<String>()) } }

#[tauri::command]
async fn backup_database(state: State<'_, AppDb>, destination: String) -> Result<String,String> { let destination=destination.trim(); if destination.is_empty(){return Err("Backup destination is required".into());} let c=conn(&state).await?; let mut sql=String::from("-- NATRA Management logical backup\nPRAGMA foreign_keys=OFF;\nBEGIN TRANSACTION;\n"); let mut tables=c.query("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",()).await.map_err(|e|e.to_string())?; while let Some(t)=tables.next().await.map_err(|e|e.to_string())? { let name:String=t.get(0).map_err(|e|e.to_string())?; let ddl:String=t.get(1).map_err(|e|e.to_string())?; if ddl.trim().is_empty(){continue;} sql.push_str(&ddl);sql.push_str(";\n"); let safe=name.replace('"',"\"\""); let mut data=c.query(format!("SELECT * FROM \"{}\"",safe),()).await.map_err(|e|e.to_string())?; let cols=data.column_names(); while let Some(r)=data.next().await.map_err(|e|e.to_string())? { let values=(0..r.column_count()).map(|i|r.get_value(i).map(sql_literal).map_err(|e|e.to_string())).collect::<Result<Vec<_>,_>>()?; let quoted=cols.iter().map(|x|format!("\"{}\"",x.replace('"',"\"\""))).collect::<Vec<_>>().join(","); sql.push_str(&format!("INSERT INTO \"{}\" ({}) VALUES ({});\n",safe,quoted,values.join(","))); } } sql.push_str("COMMIT;\nPRAGMA foreign_keys=ON;\n"); tokio::fs::write(destination,sql).await.map_err(|e|e.to_string())?; Ok(destination.to_string()) }

#[tauri::command]
async fn restore_database(state: State<'_, AppDb>, source: String) -> Result<(),String> { let source=source.trim(); if source.is_empty(){return Err("Restore source is required".into());} let sql=tokio::fs::read_to_string(source).await.map_err(|e|format!("Cannot read backup: {e}"))?; if !sql.contains("NATRA Management logical backup")||!sql.contains("BEGIN TRANSACTION;")||!sql.contains("COMMIT;"){return Err("The selected file is not a valid NATRA backup.".into());} let c=conn(&state).await?; c.execute_batch("PRAGMA foreign_keys=OFF;").await.map_err(|e|e.to_string())?; c.execute_batch(&sql).await.map_err(|e|format!("Restore failed: {e}"))?; c.execute_batch("PRAGMA foreign_keys=ON;").await.map_err(|e|e.to_string())?; Ok(()) }

#[tauri::command]
async fn sync_status(state: State<'_, AppDb>) -> Result<serde_json::Value,String> { let c=conn(&state).await?; let open=scalar_i64(&c,"SELECT COUNT(*) FROM sync_conflicts WHERE status='OPEN'").await?; let db=state.db.lock().await; let mode=match &*db{DbBackend::Synced(_)=>"cloud",DbBackend::Local(_)=>"local"}; Ok(serde_json::json!({"status":"ready","mode":mode,"open_conflicts":open})) }

#[tauri::command]
async fn sync_now(state: State<'_, AppDb>) -> Result<serde_json::Value,String> { let db=state.db.lock().await; match &*db { DbBackend::Local(_)=>Ok(serde_json::json!({"mode":"local","synced":false,"message":"Local database is operating offline."})), DbBackend::Synced(db)=>{ db.push().await.map_err(|e|format!("Cloud push failed: {e}"))?; let pulled=db.pull().await.map_err(|e|format!("Cloud pull failed: {e}"))?; Ok(serde_json::json!({"mode":"cloud","synced":true,"pulled":pulled})) } } }

#[tauri::command]
async fn get_cloud_sync_config() -> Result<serde_json::Value,String> { let(url,token)=cloud_credentials(); Ok(serde_json::json!({"configured":url.is_some()&&token.is_some(),"url":url.unwrap_or_default(),"token_configured":token.is_some(),"restart_required":true})) }

#[tauri::command]
async fn configure_cloud_sync(url:String,token:String)->Result<(),String>{let url=url.trim();let token=token.trim();if !(url.starts_with("libsql://")||url.starts_with("https://")){return Err("Enter a valid Turso/libSQL URL.".into());}if token.len()<20{return Err("The cloud auth token appears invalid or incomplete.".into());}Entry::new("NATRA-Inventory-Cloud","database-url").map_err(|e|e.to_string())?.set_password(url).map_err(|e|e.to_string())?;Entry::new("NATRA-Inventory-Cloud","auth-token").map_err(|e|e.to_string())?.set_password(token).map_err(|e|e.to_string())?;Ok(())}

#[tauri::command]
async fn set_session(state: State<'_, AppDb>, session:SessionInput)->Result<(),String>{let c=conn(&state).await?;let now=Utc::now().to_rfc3339();c.execute("INSERT INTO app_session(id,access_token,user_id,company_id,company_name,role,expires_at,updated_at) VALUES(1,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET access_token=excluded.access_token,user_id=excluded.user_id,company_id=excluded.company_id,company_name=excluded.company_name,role=excluded.role,expires_at=excluded.expires_at,updated_at=excluded.updated_at",params![session.access_token,session.user_id,session.company_id,session.company_name,session.role,session.expires_at,now]).await.map_err(|e|e.to_string())?;Ok(())}

#[tauri::command]
async fn clear_session(state: State<'_, AppDb>, user_id:String)->Result<(),String>{let c=conn(&state).await?;c.execute("DELETE FROM app_session WHERE id=1 AND user_id=?1",params![user_id]).await.map_err(|e|e.to_string())?;Ok(())}

fn database_path(app:&AppHandle)->PathBuf{let dir=app.path().app_data_dir().expect("app data dir");std::fs::create_dir_all(&dir).expect("create app data directory");dir.join("inventory.db")}

#[cfg_attr(mobile,tauri::mobile_entry_point)]
pub fn run(){
    tauri::Builder::default()
        .setup(|app|{
            let path=database_path(app.handle());
            let path_string=path.to_string_lossy().to_string();
            let(url,token)=cloud_credentials();
            tauri::async_runtime::block_on(async{
                let backend=match(url,token){
                    (Some(url),Some(token))=>DbBackend::Synced(turso::sync::Builder::new_remote(&path_string).with_remote_url(&url).with_auth_token(&token).bootstrap_if_empty(false).build().await.map_err(|e|format!("Cloud database initialization failed: {e}"))?),
                    _=>DbBackend::Local(turso::Builder::new_local(&path_string).build().await.map_err(|e|format!("Local database initialization failed: {e}"))?)
                };
                let c=match &backend{DbBackend::Local(db)=>db.connect().map_err(|e|e.to_string())?,DbBackend::Synced(db)=>db.connect().await.map_err(|e|e.to_string())?};
                init_schema(&c).await?;
                accounting_persistence::ensure_schema(&c).await?;
                app.manage(AppDb{db:Arc::new(Mutex::new(backend))});
                Ok::<(),String>(())
            }).map_err(|e|e)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_products,save_product,delete_product,record_purchase,record_expense,dashboard_summary,
            sales_bridge::record_sale,record_customer_payment,list_transactions,list_customers,save_customer,
            report_summary,sync_now,list_suppliers,create_supplier,backup_database,restore_database,sync_status,
            get_cloud_sync_config,configure_cloud_sync,list_categories,create_category,record_income,
            list_stock_movements,list_sales_history,list_purchase_history,set_session,clear_session
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
