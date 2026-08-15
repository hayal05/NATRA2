from pathlib import Path

path = Path("src-tauri/src/lib.rs")
text = path.read_text(encoding="utf-8")

start = text.index("async fn record_purchase")
end = text.index("\n#[tauri::command]", start)
block = text[start:end]

if "Purchase accounting entry" in block:
    print("Purchase accounting integration already present")
    raise SystemExit(0)

# Turso's IntoValue consumes String parameters. The purchase transaction
# still needs `now` for the journal entry, so keep an owned clone for the
# cash-transaction insert.
block = block.replace(
    "input.account.trim(),now]",
    "input.account.trim(),now.clone()]",
)

journal_code = '''    let account_code = match input.account.trim() {
        "Cash" => "1000",
        "Bank" => "1010",
        "Mobile Money" => "1020",
        _ => return Err("Invalid purchase payment account".into()),
    };
    let journal_lines: [(&str, f64, f64, &str); 2] = [
        ("1200", total, 0.0, "Inventory purchased"),
        (account_code, 0.0, total, "Purchase payment"),
    ];
    accounting::post_in_transaction(
        &tx,
        &reference,
        &now,
        "Purchase accounting entry",
        "PURCHASE",
        Some(&reference),
        &journal_lines,
    )
    .await?;

'''

commit_pos = block.rfind("tx.commit()")
if commit_pos < 0:
    raise SystemExit("record_purchase transaction commit not found")

block = block[:commit_pos] + journal_code + block[commit_pos:]
text = text[:start] + block + text[end:]
path.write_text(text, encoding="utf-8")
print("Purchase accounting integration applied")