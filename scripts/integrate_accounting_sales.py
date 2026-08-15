from pathlib import Path
import re

path = Path("src-tauri/src/lib.rs")
text = path.read_text(encoding="utf-8")

if "mod accounting;" not in text:
    text = "mod accounting;\n" + text

if "accounting::ensure_schema(&c).await?;" not in text:
    text, count = re.subn(
        r"(?m)^(\s*)init_schema\(&c\)\.await\?;\s*$",
        r"\1init_schema(&c).await?;\n\1accounting::ensure_schema(&c).await?;",
        text,
        count=1,
    )
    if count != 1:
        raise SystemExit("init_schema insertion point not found")

start = text.index("async fn record_sale")
end = text.index("\n#[derive(Debug, Deserialize)]\nstruct ReturnInput", start)
block = text[start:end]

if "accounting::post_in_transaction(" not in block:
    journal_code = '''    let receivable = subtotal - paid_amount;
    let mut journal_lines: Vec<(&str, f64, f64, &str)> = Vec::with_capacity(5);
    if paid_amount > 0.005 {
        let cash_account = if payment_method == "Credit" {
            input.payment_account.as_deref().unwrap_or("Cash").trim()
        } else {
            payment_method
        };
        let account_code = match cash_account {
            "Cash" => "1000",
            "Bank" => "1010",
            "Mobile Money" => "1020",
            _ => return Err("Invalid payment account".into()),
        };
        journal_lines.push((account_code, paid_amount, 0.0, "Sale proceeds received"));
    }
    if receivable > 0.005 {
        journal_lines.push(("1100", receivable, 0.0, "Customer receivable"));
    }
    journal_lines.push(("4000", 0.0, subtotal, "Sales revenue"));
    if cogs > 0.005 {
        journal_lines.push(("5000", cogs, 0.0, "Cost of goods sold"));
        journal_lines.push(("1200", 0.0, cogs, "Inventory carrying amount released"));
    }
    accounting::post_in_transaction(
        &tx,
        &reference,
        &now,
        "Sale accounting entry",
        "SALE",
        Some(&reference),
        &journal_lines,
    ).await?;

'''
    commit_pos = block.rfind("tx.commit()")
    if commit_pos < 0:
        raise SystemExit("record_sale transaction commit not found")
    block = block[:commit_pos] + journal_code + block[commit_pos:]
    text = text[:start] + block + text[end:]

path.write_text(text, encoding="utf-8")
print("Sales accounting integration applied")