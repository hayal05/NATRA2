from pathlib import Path

p = Path("src-tauri/src/lib.rs")
s = p.read_text(encoding="utf-8")

old = '''    tx.execute("INSERT INTO customer_payments(reference,customer_id,amount,account,payment_date) VALUES(?,?,?,?,?)",params![reference.clone(),input.customer_id,input.amount,input.account.trim(),now.clone()]).await.map_err(|e|e.to_string())?;
    tx.execute("INSERT INTO cash_transactions(reference,tx_type,description,amount,account,created_at) VALUES(?,?,?,?,?,?)",params![reference.clone(),"PAYMENT","Customer receivable payment",input.amount,input.account.trim(),now]).await.map_err(|e|e.to_string())?;
    tx.commit().await.map_err(|e| e.to_string())?;
'''

new = '''    let account_code = match input.account.trim() {
        "Cash" => "1000",
        "Bank" => "1010",
        "Mobile Money" => "1020",
        _ => return Err("Invalid payment account".into()),
    };
    tx.execute("INSERT INTO customer_payments(reference,customer_id,amount,account,payment_date) VALUES(?,?,?,?,?)",params![reference.clone(),input.customer_id,input.amount,input.account.trim(),now.clone()]).await.map_err(|e|e.to_string())?;
    tx.execute("INSERT INTO cash_transactions(reference,tx_type,description,amount,account,created_at) VALUES(?,?,?,?,?,?)",params![reference.clone(),"PAYMENT","Customer receivable payment",input.amount,input.account.trim(),now.clone()]).await.map_err(|e|e.to_string())?;

    let journal_lines: [(&str, f64, f64, &str); 2] = [
        (account_code, input.amount, 0.0, "Customer receivable payment received"),
        ("1100", 0.0, input.amount, "Accounts receivable settled"),
    ];
    accounting::post_in_transaction(
        &tx,
        &reference,
        &now,
        "Customer payment accounting entry",
        "PAYMENT",
        Some(&reference),
        &journal_lines,
    )
    .await?;

    tx.commit().await.map_err(|e| e.to_string())?;
'''

if '"Customer payment accounting entry"' in s:
    raise SystemExit("Step 4 already integrated; refusing duplicate patch.")
if old not in s:
    raise SystemExit("Expected customer payment block was not found; no source change made.")
p.write_text(s.replace(old, new, 1), encoding="utf-8")
