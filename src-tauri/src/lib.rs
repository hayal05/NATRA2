use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::{env, path::PathBuf, sync::Arc};
use tauri::{AppHandle, Manager, State};
use tokio::sync::Mutex;
use turso::{params, Connection};
use keyring::Entry;
use uuid::Uuid;

enum DbBackend {
    Local(turso::Database),
    Synced(turso::sync::Database),
}

#[derive(Clone)]
struct AppDb {
    db: Arc<Mutex<DbBackend>>,
}

#[derive(Debug, Serialize)]
struct Product {
    sku: String,
    name: String,
    category: String,
    cost: f64,
    price: f64,
    stock: f64,
    min_stock: f64,
}

#[derive(Debug, Serialize)]
struct TopProduct {
    name: String,
    sold_qty: f64,
    revenue: f64,
    profit: f64,
    margin: f64,
}

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
struct CreditSale {
    items: Vec<SaleItem>,
    customer_id: i64,
    payment_method: String,
    paid_amount: f64,
    due_date: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SupplierInput {
    name: String,
    phone: String,
    email: String,
    address: String,
}

#[derive(Debug, Deserialize)]
struct SaleItem {
    sku: String,
    qty: f64,
    unit_price: f64,
}

#[derive(Debug, Deserialize)]
struct CategoryInput { name: String }

#[derive(Debug, Deserialize)]
struct StockAdjustmentInput {
    sku: String,
    adjustment_type: String,
    qty: f64,
    reason: String,
    notes: String,
}

#[derive(Debug, Deserialize)]
struct IncomeInput {
    category: String,
    description: String,
    amount: f64,
    account: String,
}

#[derive(Debug, Deserialize)]
struct TransferInput {
    from_account: String,
    to_account: String,
    amount: f64,
    note: String,
}

async fn conn(state: &State<'_, AppDb>) -> Result<Connection, String> {
    let db = state.db.lock().await;
    match &*db {
        DbBackend::Local(db) => db.connect().map_err(|e| e.to_string()),
        DbBackend::Synced(db) => db.connect().await.map_err(|e| e.to_string()),
    }
}

fn keyring_value(name: &str) -> Option<String> {
    Entry::new("NATRA-Inventory-Cloud", name)
        .ok()
        .and_then(|entry| entry.get_password().ok())
        .filter(|value| !value.trim().is_empty())
}

fn cloud_credentials() -> (Option<String>, Option<String>) {
    let url = env::var("TURSO_DATABASE_URL").ok().filter(|v| !v.trim().is_empty())
        .or_else(|| keyring_value("database-url"));
    let token = env::var("TURSO_AUTH_TOKEN").ok().filter(|v| !v.trim().is_empty())
        .or_else(|| keyring_value("auth-token"));
    (url, token)
}

async fn init_schema(c: &Connection) -> Result<(), String> {
    c.execute_batch(r#"
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sku TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'General',
        cost REAL NOT NULL DEFAULT 0,
        price REAL NOT NULL DEFAULT 0,
        stock REAL NOT NULL DEFAULT 0,
        min_stock REAL NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sales (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        reference TEXT NOT NULL UNIQUE,
        sale_date TEXT NOT NULL,
        subtotal REAL NOT NULL,
        discount REAL NOT NULL DEFAULT 0,
        revenue REAL NOT NULL,
        cogs REAL NOT NULL,
        profit REAL NOT NULL,
        payment_method TEXT NOT NULL DEFAULT 'Cash',
        status TEXT NOT NULL DEFAULT 'COMPLETED'
      );

      CREATE TABLE IF NOT EXISTS sale_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sale_id INTEGER NOT NULL REFERENCES sales(id),
        sku TEXT NOT NULL,
        qty REAL NOT NULL,
        unit_price REAL NOT NULL,
        unit_cost REAL NOT NULL,
        line_revenue REAL NOT NULL,
        line_cogs REAL NOT NULL,
        line_profit REAL NOT NULL
      );

      CREATE TABLE IF NOT EXISTS stock_movements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        reference TEXT NOT NULL,
        sku TEXT NOT NULL,
        movement_type TEXT NOT NULL,
        qty_in REAL NOT NULL DEFAULT 0,
        qty_out REAL NOT NULL DEFAULT 0,
        balance_after REAL NOT NULL,
        unit_cost REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS purchases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        reference TEXT NOT NULL UNIQUE,
        supplier TEXT NOT NULL,
        purchase_date TEXT NOT NULL,
        total REAL NOT NULL,
        status TEXT NOT NULL DEFAULT 'RECEIVED'
      );

      CREATE TABLE IF NOT EXISTS expenses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        reference TEXT NOT NULL UNIQUE,
        category TEXT NOT NULL,
        description TEXT NOT NULL,
        amount REAL NOT NULL,
        expense_date TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS returns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        reference TEXT NOT NULL UNIQUE,
        sale_reference TEXT NOT NULL,
        sku TEXT NOT NULL,
        qty REAL NOT NULL,
        refund REAL NOT NULL,
        reason TEXT NOT NULL,
        return_date TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS customer_payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        reference TEXT NOT NULL UNIQUE,
        customer_id INTEGER NOT NULL REFERENCES customers(id),
        amount REAL NOT NULL,
        account TEXT NOT NULL DEFAULT 'Cash',
        payment_date TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS cash_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        reference TEXT NOT NULL UNIQUE,
        tx_type TEXT NOT NULL,
        description TEXT NOT NULL,
        amount REAL NOT NULL,
        account TEXT NOT NULL DEFAULT 'Cash',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS customers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        phone TEXT,
        email TEXT,
        credit_limit REAL NOT NULL DEFAULT 0,
        balance REAL NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sale_customers (
        sale_id INTEGER PRIMARY KEY REFERENCES sales(id),
        customer_id INTEGER NOT NULL REFERENCES customers(id)
      );

      CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
      CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(sale_date);
      CREATE INDEX IF NOT EXISTS idx_stock_sku ON stock_movements(sku);
      CREATE INDEX IF NOT EXISTS idx_cash_date ON cash_transactions(created_at);
      CREATE TABLE IF NOT EXISTS suppliers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        phone TEXT,
        email TEXT,
        address TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT,
        details TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sync_conflicts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        local_json TEXT NOT NULL,
        remote_json TEXT,
        status TEXT NOT NULL DEFAULT 'OPEN',
        created_at TEXT NOT NULL,
        resolved_at TEXT
      );

      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sync_outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        operation TEXT NOT NULL CHECK(operation IN ('UPSERT','DELETE')),
        payload TEXT,
        created_at TEXT NOT NULL,
        synced_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_sync_outbox_pending ON sync_outbox(synced_at, id);

      CREATE TABLE IF NOT EXISTS app_session (
        id INTEGER PRIMARY KEY CHECK(id=1),
        access_token TEXT NOT NULL,
        user_id TEXT NOT NULL,
        company_id TEXT NOT NULL,
        company_name TEXT NOT NULL,
        role TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

    "#).await.map_err(|e| e.to_string())?;

    // Additive migration marker. Future releases must add a new version and apply
    // each migration transactionally before the UI is made available.
    c.execute(
        "INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(?1,?2)",
        params!["1.1.0", Utc::now().to_rfc3339()]
    ).await.map_err(|e| e.to_string())?;

    // Production databases start empty. Sample/demo data must never be inserted automatically.
    Ok(())
}


#[derive(Debug, Deserialize)]
struct ProductInput {
    sku: String,
    name: String,
    category: String,
    cost: f64,
    price: f64,
    stock: f64,
    min_stock: f64,
}

#[derive(Debug, Deserialize)]
struct ExpenseInput {
    category: String,
    description: String,
    amount: f64,
    account: String,
}

#[derive(Debug, Deserialize)]
struct PurchaseInput {
    supplier: String,
    sku: String,
    qty: f64,
    unit_cost: f64,
    account: String,
}

#[tauri::command]
async fn list_categories(state: State<'_, AppDb>) -> Result<serde_json::Value, String> {
    let c=conn(&state).await?;
    let mut rows=c.query("SELECT id,name FROM categories ORDER BY name",()).await.map_err(|e|e.to_string())?;
    let mut out=Vec::new();
    while let Some(r)=rows.next().await.map_err(|e|e.to_string())? {
        out.push(serde_json::json!({"id":r.get::<i64>(0).unwrap_or(0),"name":r.get::<String>(1).unwrap_or_default()}));
    }
    Ok(serde_json::Value::Array(out))
}

#[tauri::command]
async fn create_category(state: State<'_, AppDb>, input: CategoryInput) -> Result<i64,String> {
    let name=input.name.trim();
    if name.is_empty(){return Err("Category name is required".into());}
    let c=conn(&state).await?;
    c.execute("INSERT INTO categories(name,created_at) VALUES(?,?)",params![name,Utc::now().to_rfc3339()]).await.map_err(|e|e.to_string())?;
    Ok(c.last_insert_rowid())
}

#[tauri::command]
async fn record_stock_adjustment(state: State<'_, AppDb>, input: StockAdjustmentInput) -> Result<String,String> {
    if input.qty<=0.0 {return Err("Adjustment quantity must be greater than zero".into());}
    let direction=input.adjustment_type.trim();
    if direction!="Increase" && direction!="Decrease" {return Err("Adjustment type must be Increase or Decrease".into());}
    let mut c=conn(&state).await?;
    let tx=c.transaction().await.map_err(|e|e.to_string())?;
    let mut rows=tx.query("SELECT stock,cost FROM products WHERE sku=?1 AND active=1",params![input.sku.trim()]).await.map_err(|e|e.to_string())?;
    let row=rows.next().await.map_err(|e|e.to_string())?.ok_or("Product not found")?;
    let stock:f64=row.get(0).map_err(|e|e.to_string())?;
    let cost:f64=row.get(1).map_err(|e|e.to_string())?;
    drop(rows);
    let new_stock=if direction=="Increase"{stock+input.qty}else{stock-input.qty};
    if new_stock<0.0{return Err("Adjustment would make stock negative".into());}
    let reference=format!("ADJ-{}",Uuid::new_v4().simple());
    let now=Utc::now().to_rfc3339();
    tx.execute("UPDATE products SET stock=?1,updated_at=?2 WHERE sku=?3",params![new_stock,now.clone(),input.sku.trim()]).await.map_err(|e|e.to_string())?;
    tx.execute("INSERT INTO stock_movements(reference,sku,movement_type,qty_in,qty_out,balance_after,unit_cost,created_at) VALUES(?,?,?,?,?,?,?,?)",params![reference.clone(),input.sku.trim(),format!("ADJUSTMENT: {}",direction),if direction=="Increase"{input.qty}else{0.0},if direction=="Decrease"{input.qty}else{0.0},new_stock,cost,now.clone()]).await.map_err(|e|e.to_string())?;
    tx.execute("INSERT INTO audit_log(actor,action,entity_type,entity_id,details,created_at) VALUES(?,?,?,?,?,?)",params!["local-user","STOCK_ADJUSTMENT","PRODUCT",input.sku.trim(),format!("{}; {}; {}",direction,input.reason.trim(),input.notes.trim()),now]).await.map_err(|e|e.to_string())?;
    tx.commit().await.map_err(|e|e.to_string())?;
    Ok(reference)
}

#[tauri::command]
async fn record_income(state: State<'_, AppDb>, input: IncomeInput) -> Result<String,String> {
    if input.amount<=0.0 || input.description.trim().is_empty(){return Err("Income amount and description are required".into());}
    let c=conn(&state).await?; let reference=format!("INC-{}",Uuid::new_v4().simple()); let now=Utc::now().to_rfc3339();
    c.execute("INSERT INTO cash_transactions(reference,tx_type,description,amount,account,created_at) VALUES(?,?,?,?,?,?)",params![reference.clone(),"INCOME",format!("{}: {}",input.category.trim(),input.description.trim()),input.amount,input.account.trim(),now]).await.map_err(|e|e.to_string())?;
    Ok(reference)
}

#[tauri::command]
async fn record_transfer(state: State<'_, AppDb>, input: TransferInput) -> Result<String,String> {
    if input.amount<=0.0{return Err("Transfer amount must be greater than zero".into());}
    if input.from_account.trim()==input.to_account.trim(){return Err("From and To accounts must be different".into());}
    let mut c=conn(&state).await?; let tx=c.transaction().await.map_err(|e|e.to_string())?; let reference=format!("TRF-{}",Uuid::new_v4().simple()); let now=Utc::now().to_rfc3339();
    tx.execute("INSERT INTO cash_transactions(reference,tx_type,description,amount,account,created_at) VALUES(?,?,?,?,?,?)",params![format!("{}-OUT",reference),"TRANSFER_OUT",format!("To {}: {}",input.to_account.trim(),input.note.trim()),input.amount,input.from_account.trim(),now.clone()]).await.map_err(|e|e.to_string())?;
    tx.execute("INSERT INTO cash_transactions(reference,tx_type,description,amount,account,created_at) VALUES(?,?,?,?,?,?)",params![format!("{}-IN",reference),"TRANSFER_IN",format!("From {}: {}",input.from_account.trim(),input.note.trim()),input.amount,input.to_account.trim(),now.clone()]).await.map_err(|e|e.to_string())?;
    tx.commit().await.map_err(|e|e.to_string())?; Ok(reference)
}

#[tauri::command]
async fn list_stock_movements(state: State<'_, AppDb>) -> Result<serde_json::Value,String> {
    let c=conn(&state).await?; let mut rows=c.query("SELECT reference,sku,movement_type,qty_in,qty_out,balance_after,unit_cost,created_at FROM stock_movements ORDER BY created_at DESC LIMIT 500",()).await.map_err(|e|e.to_string())?; let mut out=Vec::new();
    while let Some(r)=rows.next().await.map_err(|e|e.to_string())? {out.push(serde_json::json!({"reference":r.get::<String>(0).unwrap_or_default(),"sku":r.get::<String>(1).unwrap_or_default(),"movement_type":r.get::<String>(2).unwrap_or_default(),"qty_in":r.get::<f64>(3).unwrap_or(0.0),"qty_out":r.get::<f64>(4).unwrap_or(0.0),"balance_after":r.get::<f64>(5).unwrap_or(0.0),"unit_cost":r.get::<f64>(6).unwrap_or(0.0),"created_at":r.get::<String>(7).unwrap_or_default()}));}
    Ok(serde_json::Value::Array(out))
}

#[tauri::command]
async fn list_sales_history(state: State<'_, AppDb>) -> Result<serde_json::Value,String> {
    let c=conn(&state).await?; let mut rows=c.query("SELECT reference,sale_date,revenue,cogs,profit,payment_method,status FROM sales ORDER BY sale_date DESC LIMIT 500",()).await.map_err(|e|e.to_string())?; let mut out=Vec::new();
    while let Some(r)=rows.next().await.map_err(|e|e.to_string())? {out.push(serde_json::json!({"reference":r.get::<String>(0).unwrap_or_default(),"date":r.get::<String>(1).unwrap_or_default(),"revenue":r.get::<f64>(2).unwrap_or(0.0),"cogs":r.get::<f64>(3).unwrap_or(0.0),"profit":r.get::<f64>(4).unwrap_or(0.0),"payment_method":r.get::<String>(5).unwrap_or_default(),"status":r.get::<String>(6).unwrap_or_default()}));}
    Ok(serde_json::Value::Array(out))
}

#[tauri::command]
async fn list_purchase_history(state: State<'_, AppDb>) -> Result<serde_json::Value,String> {
    let c=conn(&state).await?; let mut rows=c.query("SELECT reference,supplier,purchase_date,total,status FROM purchases ORDER BY purchase_date DESC LIMIT 500",()).await.map_err(|e|e.to_string())?; let mut out=Vec::new();
    while let Some(r)=rows.next().await.map_err(|e|e.to_string())? {out.push(serde_json::json!({"reference":r.get::<String>(0).unwrap_or_default(),"supplier":r.get::<String>(1).unwrap_or_default(),"date":r.get::<String>(2).unwrap_or_default(),"total":r.get::<f64>(3).unwrap_or(0.0),"status":r.get::<String>(4).unwrap_or_default()}));}
    Ok(serde_json::Value::Array(out))
}

#[tauri::command]
async fn list_products(state: State<'_, AppDb>) -> Result<Vec<Product>, String> {
    let c = conn(&state).await?;
    let mut rows = c.query("SELECT sku,name,category,cost,price,stock,min_stock FROM products WHERE active=1 ORDER BY name", ()).await.map_err(|e| e.to_string())?;
    let mut out = vec![];
    while let Some(r) = rows.next().await.map_err(|e| e.to_string())? {
        out.push(Product {
            sku: r.get(0).map_err(|e| e.to_string())?,
            name: r.get(1).map_err(|e| e.to_string())?,
            category: r.get(2).map_err(|e| e.to_string())?,
            cost: r.get(3).map_err(|e| e.to_string())?,
            price: r.get(4).map_err(|e| e.to_string())?,
            stock: r.get(5).map_err(|e| e.to_string())?,
            min_stock: r.get(6).map_err(|e| e.to_string())?,
        });
    }
    Ok(out)
}

#[tauri::command]
async fn save_product(state: State<'_, AppDb>, input: ProductInput) -> Result<(), String> {
    if input.sku.trim().is_empty() || input.name.trim().is_empty() { return Err("SKU and product name are required".into()); }
    if input.cost < 0.0 || input.price < 0.0 || input.stock < 0.0 || input.min_stock < 0.0 { return Err("Cost, price, stock and minimum stock cannot be negative".into()); }
    let c=conn(&state).await?;
    let now=Utc::now().to_rfc3339();
    c.execute("INSERT INTO products(sku,name,category,cost,price,stock,min_stock,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(sku) DO UPDATE SET name=excluded.name,category=excluded.category,cost=excluded.cost,price=excluded.price,stock=excluded.stock,min_stock=excluded.min_stock,updated_at=excluded.updated_at",
      params![input.sku,input.name,input.category,input.cost,input.price,input.stock,input.min_stock,now.clone(),now]).await.map_err(|e|e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn delete_product(state: State<'_, AppDb>, sku: String) -> Result<(), String> {
    let c=conn(&state).await?;
    c.execute("UPDATE products SET active=0,updated_at=?1 WHERE sku=?2",params![Utc::now().to_rfc3339(),sku]).await.map_err(|e|e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn record_expense(state: State<'_, AppDb>, input: ExpenseInput) -> Result<String, String> {
    if input.amount <= 0.0 || input.description.trim().is_empty() {
        return Err("Expense amount must be greater than zero and a description is required".into());
    }
    let mut c=conn(&state).await?;
    let tx=c.transaction().await.map_err(|e| e.to_string())?;
    let now=Utc::now().to_rfc3339();
    let reference=format!("EXP-{}", Uuid::new_v4().simple());
    tx.execute("INSERT INTO expenses(reference,category,description,amount,expense_date) VALUES(?,?,?,?,?)",
        params![reference.clone(),input.category.trim(),input.description.trim(),input.amount,now.clone()]).await.map_err(|e|e.to_string())?;
    tx.execute("INSERT INTO cash_transactions(reference,tx_type,description,amount,account,created_at) VALUES(?,?,?,?,?,?)",
        params![reference.clone(),"EXPENSE","Operating expense",input.amount,input.account.trim(),now]).await.map_err(|e|e.to_string())?;
    tx.commit().await.map_err(|e|e.to_string())?;
    Ok(reference)
}

#[tauri::command]
async fn record_purchase(state: State<'_, AppDb>, input: PurchaseInput) -> Result<String, String> {
    if input.qty <= 0.0 || input.unit_cost < 0.0 || input.supplier.trim().is_empty() {
        return Err("Supplier, quantity and non-negative unit cost are required".into());
    }
    let mut c=conn(&state).await?;
    let tx=c.transaction().await.map_err(|e|e.to_string())?;
    let mut rows=tx.query("SELECT stock,cost FROM products WHERE sku=?1 AND active=1",params![input.sku.clone()]).await.map_err(|e|e.to_string())?;
    let row=rows.next().await.map_err(|e|e.to_string())?.ok_or_else(||"Product not found".to_string())?;
    let old_stock:f64=row.get(0).map_err(|e|e.to_string())?;
    let old_cost:f64=row.get(1).map_err(|e|e.to_string())?;
    drop(rows);
    let new_stock=old_stock+input.qty;
    let total=input.qty*input.unit_cost;
    // Weighted-average costing prevents a receipt from abruptly replacing the existing cost basis.
    let new_cost=if new_stock>0.0 { ((old_stock*old_cost)+(input.qty*input.unit_cost))/new_stock } else { input.unit_cost };
    let now=Utc::now().to_rfc3339();
    let reference=format!("PUR-{}", Uuid::new_v4().simple());
    tx.execute("INSERT INTO purchases(reference,supplier,purchase_date,total) VALUES(?,?,?,?)",params![reference.clone(),input.supplier.trim(),now.clone(),total]).await.map_err(|e|e.to_string())?;
    tx.execute("UPDATE products SET stock=?1,cost=?2,updated_at=?3 WHERE sku=?4",params![new_stock,new_cost,now.clone(),input.sku.clone()]).await.map_err(|e|e.to_string())?;
    tx.execute("INSERT INTO stock_movements(reference,sku,movement_type,qty_in,balance_after,unit_cost,created_at) VALUES(?,?,?,?,?,?,?)",params![reference.clone(),input.sku.clone(),"PURCHASE",input.qty,new_stock,input.unit_cost,now.clone()]).await.map_err(|e|e.to_string())?;
    tx.execute("INSERT INTO cash_transactions(reference,tx_type,description,amount,account,created_at) VALUES(?,?,?,?,?,?)",params![reference.clone(),"PURCHASE","Inventory purchase",total,input.account.trim(),now]).await.map_err(|e|e.to_string())?;
    tx.commit().await.map_err(|e|e.to_string())?;
    Ok(reference)
}

#[tauri::command]
async fn dashboard_summary(state: State<'_, AppDb>) -> Result<DashboardSummary, String> {
    let c = conn(&state).await?;
    let stock_value: f64 = scalar_f64(&c, "SELECT COALESCE(SUM(stock*cost),0) FROM products").await?;
    let today_sales: f64 = scalar_f64(&c, "SELECT COALESCE(SUM(revenue),0) FROM sales WHERE date(sale_date)=date('now','localtime')").await?;
    let gross_profit: f64 = scalar_f64(&c, "SELECT COALESCE(SUM(profit),0) FROM sales WHERE date(sale_date)=date('now','localtime')").await?;
    let cash_in: f64 = scalar_f64(&c, "SELECT COALESCE(SUM(amount),0) FROM cash_transactions WHERE tx_type IN ('INCOME','SALE') AND account != 'Credit'").await?;
    let cash_out: f64 = scalar_f64(&c, "SELECT COALESCE(SUM(amount),0) FROM cash_transactions WHERE tx_type IN ('EXPENSE','PURCHASE','PAYMENT')").await?;
    let low_stock: i64 = scalar_i64(&c, "SELECT COUNT(*) FROM products WHERE active=1 AND stock<=min_stock").await?;
    let receivables: f64 = scalar_f64(&c, "SELECT COALESCE(SUM(balance),0) FROM customers WHERE active=1").await?;
    let mut rows = c.query("SELECT p.name,COALESCE(SUM(si.qty),0),COALESCE(SUM(si.line_revenue),0),COALESCE(SUM(si.line_profit),0) FROM sale_items si JOIN products p ON p.sku=si.sku GROUP BY si.sku ORDER BY SUM(si.line_revenue) DESC LIMIT 5", ()).await.map_err(|e| e.to_string())?;
    let mut top_products = vec![];
    while let Some(r) = rows.next().await.map_err(|e| e.to_string())? {
        let revenue:f64=r.get(2).map_err(|e|e.to_string())?;
        let profit:f64=r.get(3).map_err(|e|e.to_string())?;
        top_products.push(TopProduct{name:r.get(0).map_err(|e|e.to_string())?,sold_qty:r.get(1).map_err(|e|e.to_string())?,revenue,profit,margin:if revenue>0.0{profit/revenue*100.0}else{0.0}});
    }
    Ok(DashboardSummary { stock_value, today_sales, gross_profit, cash_balance: cash_in-cash_out, low_stock, receivables, top_products })
}



async fn scalar_f64(c:&Connection, sql:&str)->Result<f64,String>{
    let mut rows=c.query(sql,()).await.map_err(|e|e.to_string())?;
    if let Some(r)=rows.next().await.map_err(|e|e.to_string())? { Ok(r.get::<f64>(0).unwrap_or(0.0)) } else { Ok(0.0) }
}

async fn scalar_i64(c:&Connection, sql:&str)->Result<i64,String>{
    let mut rows=c.query(sql,()).await.map_err(|e|e.to_string())?;
    if let Some(r)=rows.next().await.map_err(|e|e.to_string())? { Ok(r.get::<i64>(0).unwrap_or(0)) } else { Ok(0) }
}

#[derive(Debug, Deserialize)]
struct SaleInput {
    items: Vec<SaleItem>,
    payment_method: String,
}

#[tauri::command]
async fn record_sale(state: State<'_, AppDb>, input: SaleInput) -> Result<String, String> {
    if input.items.is_empty() { return Err("Sale has no items".into()); }
    let payment_method = input.payment_method.trim();
    if !["Cash","Bank","Mobile Money"].contains(&payment_method) {
        return Err("Invalid payment method".into());
    }
    let mut c = conn(&state).await?;
    let tx = c.transaction().await.map_err(|e| e.to_string())?;
    let reference = format!("SAL-{}", Uuid::new_v4().simple());
    let now = Utc::now().to_rfc3339();
    let mut subtotal=0.0;
    let mut cogs=0.0;

    for item in &input.items {
        if item.qty <= 0.0 || item.unit_price < 0.0 { return Err("Sale quantities must be greater than zero and prices cannot be negative".into()); }
        let mut rows=tx.query("SELECT cost,stock FROM products WHERE sku=?1 AND active=1", params![item.sku.clone()]).await.map_err(|e|e.to_string())?;
        let row=rows.next().await.map_err(|e|e.to_string())?.ok_or_else(||format!("Product not found: {}",item.sku))?;
        let cost:f64=row.get(0).map_err(|e|e.to_string())?;
        let stock:f64=row.get(1).map_err(|e|e.to_string())?;
        if stock < item.qty { return Err(format!("Insufficient stock for {}",item.sku)); }
        subtotal += item.qty*item.unit_price;
        cogs += item.qty*cost;
    }
    let profit=subtotal-cogs;
    tx.execute("INSERT INTO sales(reference,sale_date,subtotal,revenue,cogs,profit,payment_method) VALUES (?,?,?,?,?,?,?)",
        params![reference.clone(),now.clone(),subtotal,subtotal,cogs,profit,payment_method]).await.map_err(|e|e.to_string())?;
    let sale_id=tx.last_insert_rowid();
    for item in &input.items {
        let mut rows=tx.query("SELECT cost,stock FROM products WHERE sku=?1 AND active=1",params![item.sku.clone()]).await.map_err(|e|e.to_string())?;
        let row=rows.next().await.map_err(|e|e.to_string())?.ok_or_else(||format!("Product not found: {}",item.sku))?;
        let cost:f64=row.get(0).map_err(|e|e.to_string())?;
        let stock:f64=row.get(1).map_err(|e|e.to_string())?;
        if stock < item.qty { return Err(format!("Insufficient stock for {}",item.sku)); }
        let new_stock=stock-item.qty;
        let revenue=item.qty*item.unit_price;
        let line_cogs=item.qty*cost;
        tx.execute("INSERT INTO sale_items(sale_id,sku,qty,unit_price,unit_cost,line_revenue,line_cogs,line_profit) VALUES (?,?,?,?,?,?,?,?)",
            params![sale_id,item.sku.clone(),item.qty,item.unit_price,cost,revenue,line_cogs,revenue-line_cogs]).await.map_err(|e|e.to_string())?;
        tx.execute("UPDATE products SET stock=?1,updated_at=?2 WHERE sku=?3",params![new_stock,now.clone(),item.sku.clone()]).await.map_err(|e|e.to_string())?;
        tx.execute("INSERT INTO stock_movements(reference,sku,movement_type,qty_out,balance_after,unit_cost,created_at) VALUES (?,?,?,?,?,?,?)",
            params![reference.clone(),item.sku.clone(),"SALE",item.qty,new_stock,cost,now.clone()]).await.map_err(|e|e.to_string())?;
    }
    tx.execute("INSERT INTO cash_transactions(reference,tx_type,description,amount,account,created_at) VALUES (?,?,?,?,?,?)",
        params![reference.clone(),"SALE","POS sale",subtotal,payment_method,now]).await.map_err(|e|e.to_string())?;
    tx.commit().await.map_err(|e|e.to_string())?;
    Ok(reference)
}

#[derive(Debug, Deserialize)]
struct ReturnInput {
    sale_reference: String,
    sku: String,
    qty: f64,
    reason: String,
    account: String,
}

#[tauri::command]
async fn record_return(state: State<'_, AppDb>, input: ReturnInput) -> Result<String, String> {
    if input.qty <= 0.0 || input.sale_reference.trim().is_empty() || input.sku.trim().is_empty() {
        return Err("Sale reference, SKU and positive quantity are required".into());
    }
    let mut c = conn(&state).await?;
    let tx = c.transaction().await.map_err(|e| e.to_string())?;
    let mut rows = tx.query("SELECT s.id, si.qty, si.unit_price, si.unit_cost FROM sales s JOIN sale_items si ON si.sale_id=s.id WHERE s.reference=?1 AND si.sku=?2", params![input.sale_reference.clone(), input.sku.clone()]).await.map_err(|e| e.to_string())?;
    let row = rows.next().await.map_err(|e| e.to_string())?.ok_or("Sale item not found")?;
    let sale_id:i64 = row.get(0).map_err(|e| e.to_string())?;
    let sold_qty:f64 = row.get(1).map_err(|e| e.to_string())?;
    let unit_price:f64 = row.get(2).map_err(|e| e.to_string())?;
    let unit_cost:f64 = row.get(3).map_err(|e| e.to_string())?;
    drop(rows);
    let mut returned_rows = tx
        .query(
            "SELECT COALESCE(SUM(qty),0) FROM returns WHERE sale_reference=?1 AND sku=?2",
            params![input.sale_reference.clone(), input.sku.clone()],
        )
        .await
        .map_err(|e| e.to_string())?;
    let already_returned:f64 = match returned_rows.next().await.map_err(|e| e.to_string())? {
        Some(row) => row.get::<f64>(0).unwrap_or(0.0),
        None => 0.0,
    };
    drop(returned_rows);
    if input.qty > sold_qty - already_returned { return Err("Return quantity exceeds the remaining returnable quantity".into()); }
    let mut pr = tx.query("SELECT stock FROM products WHERE sku=?1 AND active=1", params![input.sku.clone()]).await.map_err(|e| e.to_string())?;
    let prow = pr.next().await.map_err(|e| e.to_string())?.ok_or("Product not found")?;
    let stock:f64 = prow.get(0).map_err(|e| e.to_string())?;
    drop(pr);
    let new_stock=stock+input.qty;
    let refund=input.qty*unit_price;
    let reference=format!("RET-{}", Uuid::new_v4().simple());
    let now=Utc::now().to_rfc3339();
    tx.execute("INSERT INTO returns(reference,sale_reference,sku,qty,refund,reason,return_date) VALUES(?,?,?,?,?,?,?)", params![reference.clone(),input.sale_reference,input.sku.clone(),input.qty,refund,input.reason.trim(),now.clone()]).await.map_err(|e| e.to_string())?;
    tx.execute("UPDATE products SET stock=?1,updated_at=?2 WHERE sku=?3", params![new_stock,now.clone(),input.sku.clone()]).await.map_err(|e| e.to_string())?;
    tx.execute("INSERT INTO stock_movements(reference,sku,movement_type,qty_in,balance_after,unit_cost,created_at) VALUES(?,?,?,?,?,?,?)", params![reference.clone(),input.sku.clone(), "RETURN", input.qty,new_stock,unit_cost,now.clone()]).await.map_err(|e| e.to_string())?;
    let returned_cogs=input.qty*unit_cost;
    let returned_profit=refund-returned_cogs;
    tx.execute("UPDATE sales SET revenue=revenue-?1,cogs=cogs-?2,profit=profit-?3 WHERE id=?4",
        params![refund,returned_cogs,returned_profit,sale_id]).await.map_err(|e|e.to_string())?;
    tx.execute("INSERT INTO cash_transactions(reference,tx_type,description,amount,account,created_at) VALUES(?,?,?,?,?,?)", params![reference.clone(),"REFUND","Customer return refund",refund,input.account.trim(),now]).await.map_err(|e| e.to_string())?;
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(reference)
}

#[derive(Debug, Deserialize)]
struct PaymentInput {
    customer_id: i64,
    amount: f64,
    account: String,
}

#[tauri::command]
async fn record_customer_payment(state: State<'_, AppDb>, input: PaymentInput) -> Result<String, String> {
    if input.amount <= 0.0 || input.customer_id <= 0 { return Err("Valid customer and payment amount are required".into()); }
    let mut c=conn(&state).await?;
    let tx=c.transaction().await.map_err(|e|e.to_string())?;
    let mut rows=tx.query("SELECT balance FROM customers WHERE id=?1 AND active=1",params![input.customer_id]).await.map_err(|e|e.to_string())?;
    let row=rows.next().await.map_err(|e|e.to_string())?.ok_or("Customer not found")?;
    let balance:f64=row.get(0).map_err(|e|e.to_string())?;
    drop(rows);
    if input.amount > balance { return Err("Payment cannot exceed the customer's outstanding balance".into()); }
    let reference=format!("PAY-{}",Uuid::new_v4().simple());
    let now=Utc::now().to_rfc3339();
    tx.execute("UPDATE customers SET balance=balance-?1 WHERE id=?2",params![input.amount,input.customer_id]).await.map_err(|e|e.to_string())?;
    tx.execute("INSERT INTO customer_payments(reference,customer_id,amount,account,payment_date) VALUES(?,?,?,?,?)",params![reference.clone(),input.customer_id,input.amount,input.account.trim(),now.clone()]).await.map_err(|e|e.to_string())?;
    tx.execute("INSERT INTO cash_transactions(reference,tx_type,description,amount,account,created_at) VALUES(?,?,?,?,?,?)",params![reference.clone(),"PAYMENT","Customer receivable payment",input.amount,input.account.trim(),now]).await.map_err(|e|e.to_string())?;
    tx.commit().await.map_err(|e|e.to_string())?;
    Ok(reference)
}

#[derive(Debug, Serialize)]
struct ReportSummary {
    revenue: f64,
    cogs: f64,
    profit: f64,
    margin: f64,
    inventory_value: f64,
    low_stock: i64,
    receivables: f64,
    cash_in: f64,
    cash_out: f64,
}

#[tauri::command]
async fn report_summary(state: State<'_, AppDb>) -> Result<ReportSummary,String> {
    let c=conn(&state).await?;
    let revenue=scalar_f64(&c,"SELECT COALESCE(SUM(revenue),0) FROM sales").await?;
    let cogs=scalar_f64(&c,"SELECT COALESCE(SUM(cogs),0) FROM sales").await?;
    let profit=scalar_f64(&c,"SELECT COALESCE(SUM(profit),0) FROM sales").await?;
    let inventory_value=scalar_f64(&c,"SELECT COALESCE(SUM(stock*cost),0) FROM products WHERE active=1").await?;
    let low_stock=scalar_i64(&c,"SELECT COUNT(*) FROM products WHERE active=1 AND stock<=min_stock").await?;
    let receivables=scalar_f64(&c,"SELECT COALESCE(SUM(balance),0) FROM customers WHERE active=1").await?;
    let cash_in=scalar_f64(&c,"SELECT COALESCE(SUM(amount),0) FROM cash_transactions WHERE tx_type IN ('SALE','INCOME','PAYMENT') AND account != 'Credit'").await?;
    let cash_out=scalar_f64(&c,"SELECT COALESCE(SUM(amount),0) FROM cash_transactions WHERE tx_type IN ('EXPENSE','PURCHASE','REFUND')").await?;
    Ok(ReportSummary{revenue,cogs,profit,margin:if revenue>0.0{profit/revenue*100.0}else{0.0},inventory_value,low_stock,receivables,cash_in,cash_out})
}


#[derive(Debug, Serialize)]
struct LedgerRow {
    reference: String,
    tx_type: String,
    description: String,
    amount: f64,
    account: String,
    created_at: String,
}

#[tauri::command]
async fn list_transactions(state: State<'_, AppDb>) -> Result<Vec<LedgerRow>, String> {
    let c = conn(&state).await?;
    let mut rows = c.query("SELECT reference,tx_type,description,amount,account,created_at FROM cash_transactions ORDER BY created_at DESC LIMIT 250", ()).await.map_err(|e| e.to_string())?;
    let mut out = vec![];
    while let Some(r) = rows.next().await.map_err(|e| e.to_string())? {
        out.push(LedgerRow {
            reference: r.get(0).map_err(|e| e.to_string())?,
            tx_type: r.get(1).map_err(|e| e.to_string())?,
            description: r.get(2).map_err(|e| e.to_string())?,
            amount: r.get(3).map_err(|e| e.to_string())?,
            account: r.get(4).map_err(|e| e.to_string())?,
            created_at: r.get(5).map_err(|e| e.to_string())?,
        });
    }
    Ok(out)
}

#[derive(Debug, Serialize)]
struct Customer {
    id: i64,
    name: String,
    phone: String,
    email: String,
    credit_limit: f64,
    balance: f64,
}

#[derive(Debug, Deserialize)]
struct CustomerInput {
    name: String,
    phone: String,
    email: String,
    credit_limit: f64,
}

#[tauri::command]
async fn list_customers(state: State<'_, AppDb>) -> Result<Vec<Customer>, String> {
    let c = conn(&state).await?;
    let mut rows = c.query("SELECT id,name,COALESCE(phone,''),COALESCE(email,''),credit_limit,balance FROM customers WHERE active=1 ORDER BY name", ()).await.map_err(|e| e.to_string())?;
    let mut out = vec![];
    while let Some(r) = rows.next().await.map_err(|e| e.to_string())? {
        out.push(Customer { id:r.get(0).map_err(|e|e.to_string())?, name:r.get(1).map_err(|e|e.to_string())?, phone:r.get(2).map_err(|e|e.to_string())?, email:r.get(3).map_err(|e|e.to_string())?, credit_limit:r.get(4).map_err(|e|e.to_string())?, balance:r.get(5).map_err(|e|e.to_string())? });
    }
    Ok(out)
}

#[tauri::command]
async fn save_customer(state: State<'_, AppDb>, input: CustomerInput) -> Result<(), String> {
    if input.name.trim().is_empty() { return Err("Customer name is required".into()); }
    let c=conn(&state).await?;
    c.execute("INSERT INTO customers(name,phone,email,credit_limit,created_at) VALUES(?,?,?,?,?)", params![input.name.trim(),input.phone.trim(),input.email.trim(),input.credit_limit,Utc::now().to_rfc3339()]).await.map_err(|e|e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn sync_now(state: State<'_, AppDb>) -> Result<(), String> {
    let db=state.db.lock().await;
    match &*db {
        DbBackend::Synced(db) => {
            db.push().await.map_err(|e|e.to_string())?;
            db.pull().await.map_err(|e|e.to_string())?;
            Ok(())
        }
        DbBackend::Local(_) => Err("Cloud sync is not configured. Local mode is active.".into()),
    }
}


#[tauri::command]
async fn list_suppliers(state: State<'_, AppDb>) -> Result<serde_json::Value, String> {
    let c = conn(&state).await?;
    let mut rows = c.query("SELECT id,name,phone,email,address FROM suppliers WHERE active=1 ORDER BY name", ()).await.map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    while let Some(r) = rows.next().await.map_err(|e| e.to_string())? {
        out.push(serde_json::json!({
            "id": r.get::<i64>(0).unwrap_or(0),
            "name": r.get::<String>(1).unwrap_or_default(),
            "phone": r.get::<String>(2).unwrap_or_default(),
            "email": r.get::<String>(3).unwrap_or_default(),
            "address": r.get::<String>(4).unwrap_or_default()
        }));
    }
    Ok(serde_json::Value::Array(out))
}

#[tauri::command]
async fn create_supplier(state: State<'_, AppDb>, input: SupplierInput) -> Result<i64, String> {
    let c = conn(&state).await?;
    let now = Utc::now().to_rfc3339();
    c.execute("INSERT INTO suppliers(name,phone,email,address,created_at,updated_at) VALUES (?,?,?,?,?,?)",
        params![input.name,input.phone,input.email,input.address,now.clone(),now]).await.map_err(|e| e.to_string())?;
    Ok(c.last_insert_rowid())
}

#[tauri::command]
async fn backup_database(state: State<'_, AppDb>, destination: String) -> Result<String, String> {
    let destination = destination.trim();
    if destination.is_empty() { return Err("Backup destination is required".into()); }
    let c = conn(&state).await?;
    let mut sql = String::from("-- NATRA Management logical backup\n-- Generated by the application; validate before restore.\nPRAGMA foreign_keys=OFF;\nBEGIN TRANSACTION;\n");

    let mut tables = c.query(
        "SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        ()
    ).await.map_err(|e| e.to_string())?;

    while let Some(r) = tables.next().await.map_err(|e| e.to_string())? {
        let name:String=r.get(0).map_err(|e|e.to_string())?;
        let ddl:String=r.get(1).map_err(|e|e.to_string())?;
        if ddl.trim().is_empty() { continue; }
        sql.push_str(&ddl);
        sql.push_str(";\n");

        let safe_name=name.replace('"',"\"\"");
        let mut data=c.query(&format!("SELECT * FROM \"{}\"",safe_name),()).await.map_err(|e|e.to_string())?;
        let columns=data.column_names();
        while let Some(row)=data.next().await.map_err(|e|e.to_string())? {
            let mut values=Vec::with_capacity(row.column_count());
            for i in 0..row.column_count() {
                let value=row.get_value(i).map_err(|e|e.to_string())?;
                let rendered=match value {
                    turso::Value::Null => "NULL".to_string(),
                    turso::Value::Integer(v) => v.to_string(),
                    turso::Value::Real(v) => v.to_string(),
                    turso::Value::Text(v) => format!("'{}'",v.replace('\'',"''")),
                    turso::Value::Blob(v) => format!("X'{}'",v.iter().map(|b|format!("{b:02X}")).collect::<String>()),
                };
                values.push(rendered);
            }
            sql.push_str(&format!(
                "INSERT INTO \"{}\" ({}) VALUES ({});\n",
                safe_name,
                columns.iter().map(|c|format!("\"{}\"",c.replace('"',"\"\""))).collect::<Vec<_>>().join(","),
                values.join(",")
            ));
        }
    }
    sql.push_str("COMMIT;\nPRAGMA foreign_keys=ON;\n");
    tokio::fs::write(destination, sql).await.map_err(|e| e.to_string())?;
    Ok(destination.to_string())
}

#[tauri::command]
async fn restore_database(state: State<'_, AppDb>, source: String) -> Result<(), String> {
    let source=source.trim();
    if source.is_empty() { return Err("Restore source is required".into()); }
    let sql=tokio::fs::read_to_string(source).await.map_err(|e|format!("Cannot read backup: {e}"))?;
    if !sql.contains("NATRA Management logical backup") || !sql.contains("BEGIN TRANSACTION;") || !sql.contains("COMMIT;") {
        return Err("The selected file is not a valid NATRA backup.".into());
    }
    let c=conn(&state).await?;
    c.execute_batch("PRAGMA foreign_keys=OFF;").await.map_err(|e|e.to_string())?;
    c.execute_batch(&sql).await.map_err(|e|format!("Restore failed; database was not safely restored: {e}"))?;
    c.execute_batch("PRAGMA foreign_keys=ON;").await.map_err(|e|e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn sync_status(state: State<'_, AppDb>) -> Result<serde_json::Value, String> {
    let c = conn(&state).await?;
    let open: i64 = scalar_i64(&c, "SELECT COUNT(*) FROM sync_conflicts WHERE status='OPEN'").await?;
    let db = state.db.lock().await;
    let mode = match &*db { DbBackend::Synced(_) => "cloud", DbBackend::Local(_) => "local" };
    Ok(serde_json::json!({"status":"ready","mode":mode,"open_conflicts":open}))
}


#[tauri::command]
async fn get_cloud_sync_config() -> Result<serde_json::Value, String> {
    let (url, token) = cloud_credentials();
    Ok(serde_json::json!({
        "configured": url.is_some() && token.is_some(),
        "url": url.unwrap_or_default(),
        "token_configured": token.is_some(),
        "restart_required": false
    }))
}

#[tauri::command]
async fn configure_cloud_sync(url: String, token: String) -> Result<(), String> {
    let url = url.trim();
    let token = token.trim();
    if !(url.starts_with("libsql://") || url.starts_with("https://")) {
        return Err("Enter a valid Turso/libSQL URL.".into());
    }
    if token.len() < 20 {
        return Err("The cloud auth token appears invalid or incomplete.".into());
    }
    Entry::new("NATRA-Inventory-Cloud", "database-url")
        .map_err(|e| e.to_string())?
        .set_password(url)
        .map_err(|e| e.to_string())?;
    Entry::new("NATRA-Inventory-Cloud", "auth-token")
        .map_err(|e| e.to_string())?
        .set_password(token)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Debug, Deserialize)]
struct SessionInput {
    access_token: String,
    user_id: String,
    company_id: String,
    company_name: String,
    role: String,
    expires_at: String,
}

#[tauri::command]
async fn set_session(state: State<'_, AppDb>, session: SessionInput) -> Result<(), String> {
    let c = conn(&state).await?;
    let now = Utc::now().to_rfc3339();
    c.execute(
        "INSERT INTO app_session(id,access_token,user_id,company_id,company_name,role,expires_at,updated_at) VALUES(1,?,?,?,?,?,?,?) \
         ON CONFLICT(id) DO UPDATE SET access_token=excluded.access_token,user_id=excluded.user_id,company_id=excluded.company_id,company_name=excluded.company_name,role=excluded.role,expires_at=excluded.expires_at,updated_at=excluded.updated_at",
        params![session.access_token, session.user_id, session.company_id, session.company_name, session.role, session.expires_at, now]
    ).await.map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn clear_session(state: State<'_, AppDb>, user_id: String) -> Result<(), String> {
    let c = conn(&state).await?;
    c.execute("DELETE FROM app_session WHERE id=1 AND user_id=?1", params![user_id]).await.map_err(|e| e.to_string())?;
    Ok(())
}

fn database_path(app: &AppHandle) -> PathBuf {
    let dir = app.path().app_data_dir().expect("app data dir");
    std::fs::create_dir_all(&dir).expect("create app data directory");
    dir.join("inventory.db")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
      .setup(|app| {
        let path=database_path(app.handle());
        let path_string=path.to_string_lossy().to_string();
        let (url, token) = cloud_credentials();

        tauri::async_runtime::block_on(async {
            let backend = match (url, token) {
                (Some(url), Some(token)) => {
                    let db=turso::sync::Builder::new_remote(&path_string)
                        .with_remote_url(&url)
                        .with_auth_token(&token)
                        .bootstrap_if_empty(false)
                        .build()
                        .await
                        .map_err(|e| format!("Cloud database initialization failed: {e}"))?;
                    DbBackend::Synced(db)
                }
                _ => {
                    let db=turso::Builder::new_local(&path_string)
                        .build()
                        .await
                        .map_err(|e| format!("Local database initialization failed: {e}"))?;
                    DbBackend::Local(db)
                }
            };
            let c = match &backend {
                DbBackend::Local(db) => db.connect().map_err(|e| e.to_string())?,
                DbBackend::Synced(db) => db.connect().await.map_err(|e| e.to_string())?,
            };
            init_schema(&c).await?;
            app.manage(AppDb{db:Arc::new(Mutex::new(backend))});
            Ok::<(),String>(())
        }).map_err(|e| e)?;

        Ok(())
      })
      .invoke_handler(tauri::generate_handler![list_products,save_product,delete_product,record_purchase,record_expense,dashboard_summary,record_sale,record_return,record_customer_payment,list_transactions,list_customers,save_customer,report_summary,sync_now,list_suppliers,create_supplier,backup_database,restore_database,sync_status,get_cloud_sync_config,configure_cloud_sync,list_categories,create_category,record_stock_adjustment,record_income,record_transfer,list_stock_movements,list_sales_history,list_purchase_history,set_session,clear_session])
      .run(tauri::generate_context!())
      .expect("error while running tauri application");
}
