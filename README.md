# Overview

XVolume is a Open Source Solana Volume/Buy-Sell Bot toolkit for macOS and Windows. It runs locally and offers the following features:

- **Manage multiple wallets**: Each wallet manages its own SOL and SPL tokens.
- **Multi-wallet operations**: Perform multi-wallet buys and sells of tokens seamlessly.
- **SOL distribution/unification**: Distribute or unify SOL across wallets in one step.
- **SPL token unification**: Consolidate SPL tokens from multiple wallets into one.
- **Automated trading cycles**: Run repeated buy/sell cycles automatically.
- **User-friendly console menu**: Navigate with numeric or letter-based menu options.

[![Alt-Text](https://raw.githubusercontent.com/the-real-t30d0r/xvolume/refs/heads/main/xvolume.png)]
## Highlights

- **Create Wallets**: Generates new local wallets, each with a random Keypair.
- **Show Wallets**: Refresh SOL balances and token details for each wallet.
- **Manage Coins**: Add or edit coin metadata (name, mint, decimals).
- **Multi-Wallet-Buy**: Purchase a token across multiple wallets simultaneously. Specify random amounts, max, or static values.
- **Multi-Wallet-Sell**: Sell a chosen token from multiple wallets. Options include selling all, a percentage, or random min/max amounts.
- **Multi-Buy-Sell Cycle**: Automates repeated buy→sell sequences, e.g., over 3 cycles, to generate continuous volume.
- **Unify SOL**: Combine SOL from multiple wallets into one (or an external wallet).
- **Unify Coins**: Gather a specific SPL token from multiple wallets into one.
- **Distribute SOL**: Split a specified SOL amount from one wallet into many.
- **Dashboard**: A real-time updating screen with an ASCII chart. Quit by pressing `q` + Enter.

## Frequently Asked Questions

### Why is there a minimum buy of ~0.01 SOL (per wallet)?
Buying below ~0.01 SOL often leads to aggregator rejections or leftover issues, causing skipped wallets.

### Why do I need a custom RPC provider?
Public RPCs have strict rate limits. After ~4 wallets, you may experience slow or failed transactions. A dedicated RPC eliminates this issue.

### Why do some transactions take longer?
This can occur due to network congestion. Aggregators may retry on 429/503 errors. XVolume handles multiple attempts automatically.

### Why 0.005 SOL for new token accounts?
SPL token accounts require rent-exempt deposits. XVolume reserves 0.005 SOL for brand-new wallets to support token interactions.

### Can I run XVolume without a paid RPC plan?
Possibly, but it risks frequent slowdowns or errors after a few wallets. Paid solutions (e.g., QuickNode) are highly recommended.

### What if I want 0 leftover for fees?
Without leftovers, the wallet cannot execute future transactions. XVolume retains a small amount to ensure future operations.

### Is my transaction guaranteed to succeed?
Not always. If there’s no liquidity route or leftover SOL is insufficient, transactions may fail. Errors are logged to the console.

### Can I use it on a MacBook?
Yes. XVolume is compatible with both macOS and Windows. Use the Terminal or double-click the binary to run it.

