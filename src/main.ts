

import fs from "fs";
import path from "path";
import inquirer from "inquirer";
import {
  Connection,
  Keypair,
  VersionedTransaction,
  PublicKey,
  Transaction,
  SystemProgram,
  SendOptions
} from "@solana/web3.js";
import fetch from "cross-fetch";
import { Wallet } from "@project-serum/anchor";
import { Buffer } from "buffer";
import readline from "readline";
import bs58 from "bs58";
import envPaths from "env-paths";
import pLimit from "p-limit";

type SplParsed = {
  type: string;
  info: SplTokenAccountInfo;
};

type SplParsedData = {
  parsed: SplParsed;
  program: string;
  space: number;
};

type SplTokenAccountInfo = {
  mint: string;
  owner: string;
  tokenAmount: {
    amount: string;
    decimals: number;
    uiAmount: number;
    uiAmountString: string;
  };
};




const os = detectOs(); 

function detectOs() {
  const pf = process.platform; 
  if (pf === "win32") return "windows";
  else if (pf === "darwin") return "macos";
  else return "linux"; 
}




function getConfigDir(): string {
  const home = process.env.HOME || process.env.USERPROFILE || ".";
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming");
    return path.join(appData, "XVolume");
  } else if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "XVolume");
  } else {
    return path.join(home, ".config", "XVolume");
  }
}


const configDir = getConfigDir();


const CONFIG_FILE = path.join(configDir, "config.json");
const clientVersion = "1.1.4";





interface ConfigData {
  rpcUrl: string;
}

function loadConfig(): ConfigData {
  if (!fs.existsSync(CONFIG_FILE)) {
    const def: ConfigData = {
      rpcUrl: "https://api.mainnet-beta.solana.com",
    };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(def, null, 2), "utf-8");
    return def;
  }
  try {
    const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
    return JSON.parse(raw) as ConfigData;
  } catch {
    return { rpcUrl: "https://api.mainnet-beta.solana.com" };
  }
}

function saveConfig(cfg: ConfigData) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), "utf-8");
  console.log("✅ [info] Config saved =>", CONFIG_FILE);
}




import si from "systeminformation";
import crypto from "crypto";

async function getHardwareFingerprint(): Promise<string> {
  const diskData = await si.diskLayout();
  const cpuData = await si.cpu();
  const baseData = await si.baseboard();

  const toHash = [
    diskData[0]?.serialNum,
    cpuData.brand,
    cpuData.vendor,
    baseData.serial,
  ].join("|");

  return crypto.createHash("sha256").update(toHash).digest("hex");
}









interface WalletEntry {
  private_key: string;
  public_key: string;
  balance: number;
  tokenAccounts?: Record<
    string,
    {
      tokenAddress?: string;
      lamBalance: number; 
      uiBalance: number;  
      mint: string;
      decimals: number;
      metaName?: string;
    }
  >;
}

interface CoinEntry {
  name: string;
  mint: string;
  decimals?: number;
  market_address?: string;
  seller_pub?: string;
  seller_priv?: string;
  seller_token_acc?: string;
}

interface DBInterface {
  wallets: WalletEntry[];
  coins: CoinEntry[];
}

const DB_FILE = path.join(configDir, "wallets.json");

function loadDB(): DBInterface {
  if (!fs.existsSync(DB_FILE)) {
    console.log("⚠️ [warn] DB file not found => creating empty..");
    return { wallets: [], coins: [] };
  }
  const raw = fs.readFileSync(DB_FILE, "utf-8");
  return JSON.parse(raw) as DBInterface;
}

function saveDB(db: DBInterface) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), "utf-8");
  console.log("✅ [info] DB saved =>", DB_FILE);
}




const configData = loadConfig();
let connection = new Connection(configData.rpcUrl);

function reloadConnection() {
  connection = new Connection(configData.rpcUrl);
  console.log("🔗 [info] RPC re-initialized =>", configData.rpcUrl);
}




async function fetchTokenMetadata(mintAddr: string): Promise<any | null> {
  try {
    const solscanURL = `https://public-api.solscan.io/token/meta?token=${mintAddr}`;
    const r = await fetch(solscanURL);
    if (r.status === 200) {
      return r.json();
    }
    return null;
  } catch {
    return null;
  }
}

async function getJupiterQuote(inputMint: string, outputMint: string, amount: number): Promise<any> {
  const url = `https://quote-api.jup.ag/v6/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=200`;
  const resp = await fetch(url);
  return resp.json();
}

async function jupiterSwapTransaction(quoteResponse: any, userPub: string) {
  const body = {
    quoteResponse,
    userPublicKey: userPub,
    wrapAndUnwrapSol: true,
    dynamicComputeUnitLimit: true,
    prioritizationFeeLamports: 1_300_000, 
  };
  const r = await fetch("https://quote-api.jup.ag/v6/swap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json();
}




async function getSolPriceUsd(): Promise<number | null> {
  try {
    const url = "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd";
    const r = await fetch(url);
    const j = await r.json();
    return j.solana.usd || null;
  } catch {
    return null;
  }
}


async function getDexScreenerData(mintAddr: string): Promise<any | null> {
  const url = `https://io.dexscreener.com/u/v1/tokens/solana:${mintAddr}`;
  try {
    const r = await fetch(url);
    if (r.status !== 200) return null;
    return r.json();
  } catch {
    return null;
  }
}




function keypairFromHex64(hexStr: string): Keypair {
  if (hexStr.length !== 128) {
    throw new Error(`Need 128-char HEX => got length=${hexStr.length}`);
  }
  const raw = Buffer.from(hexStr, "hex");
  if (raw.length !== 64) {
    throw new Error(`After decode => not 64 bytes, got=${raw.length}`);
  }
  return Keypair.fromSecretKey(raw);
}

function usableBalance(balance: number): number {
  return balance * 0.99;
}

function randomBetween(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}




async function systemTransferSol(
  senderKP: Keypair,
  recipient: string,
  solAmt: number
): Promise<string | null> {
  try {
    const lamports = Math.floor(solAmt * 1e9);
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: senderKP.publicKey,
        toPubkey: new PublicKey(recipient),
        lamports,
      })
    );
    const sig = await connection.sendTransaction(tx, [senderKP], {
      skipPreflight: true,
      maxRetries: 3,
    } as SendOptions);
    await connection.confirmTransaction(sig, "processed");
    return sig;
  } catch (e: any) {
    console.log("❌ [error] systemTransferSol =>", e?.message || e);
    return null;
  }
}





async function displayStartBanner() {
  const t = new Date();
  const timeStr = t.toLocaleTimeString();
  const solP = await getSolPriceUsd();


}




import { getOrCreateAssociatedTokenAccount, transfer } from "@solana/spl-token";

async function unifyTokensUI(db: DBInterface) {
  if (!db.wallets.length) {
    console.log("❌ [error] No wallets => abort unifyTokens");
    return;
  }
  if (!db.coins.length) {
    console.log("⚠️ [warn] No coins => cannot unify tokens => abort");
    return;
  }

  
  const coinChoices = db.coins.map((c, i) => ({
    name: `${c.name} => mint=${c.mint}`,
    value: i,
  }));
  const { coinIdx } = await inquirer.prompt({
    type: "list",
    name: "coinIdx",
    message: "Which SPL-Token do you want to unify?",
    choices: coinChoices,
  });
  const chosenCoin = db.coins[coinIdx];
  const unifyMintAddr = chosenCoin.mint;
  const unifyDecimals = chosenCoin.decimals || 6;
  const mintPub = new PublicKey(unifyMintAddr);

  
  const destChoice = await inquirer.prompt({
    type: "list",
    name: "destChoice",
    message: "Destination wallet? (choose from DB or external)",
    choices: [
      { name: "Pick from DB", value: "db" },
      { name: "Enter external pubkey", value: "ext" },
    ],
  });

  let destPublicKey: PublicKey;
  if (destChoice.destChoice === "db") {
    const wCh = db.wallets.map((w, i) => ({
      name: `${i + 1}) ${w.public_key} (SOL=${w.balance.toFixed(3)})`,
      value: i,
    }));
    const { destIdx } = await inquirer.prompt({
      type: "list",
      name: "destIdx",
      message: "Which wallet is DESTINATION for the token?",
      choices: wCh,
    });
    destPublicKey = new PublicKey(db.wallets[destIdx].public_key);
  } else {
    const { extPub } = await inquirer.prompt({
      type: "input",
      name: "extPub",
      message: "Enter external wallet's public key:",
    });
    try {
      destPublicKey = new PublicKey(extPub);
    } catch (e) {
      console.log("❌ [error] invalid external pubkey => abort unifyTokens");
      return;
    }
  }

  
  const walletChoices = db.wallets.map((w, i) => ({
    name: `${i + 1}) ${w.public_key} (SOL=${w.balance.toFixed(3)})`,
    value: i,
  }));
  const { sourceIdxs } = await inquirer.prompt<{ sourceIdxs: number[] }>([
    {
      type: "checkbox",
      name: "sourceIdxs",
      message: "Select SOURCE wallets to unify from:",
      choices: walletChoices,
    },
  ]);
  if (!sourceIdxs.length) {
    console.log("⚠️ [warn] no source wallets => abort unifyTokens");
    return;
  }

  const MIN_SOL_LEFTOVER = 0.001;

  
  for (const sIdx of sourceIdxs) {
    const sWal = db.wallets[sIdx];
    if (!sWal.tokenAccounts || !sWal.tokenAccounts[unifyMintAddr]) {
      console.log(`⚠️ [warn] wallet=${sWal.public_key} => no token => skip`);
      continue;
    }
    const tAcc = sWal.tokenAccounts[unifyMintAddr];
    if (tAcc.uiBalance <= 0) {
      console.log(`⚠️ [warn] wallet=${sWal.public_key} => zero balance => skip`);
      continue;
    }
    if (sWal.balance < MIN_SOL_LEFTOVER) {
      console.log(`⚠️ [warn] wallet=${sWal.public_key} => below leftover => skip`);
      continue;
    }

    const lamToken = Math.floor(tAcc.uiBalance * 10 ** unifyDecimals);
    if (lamToken <= 0) {
      console.log(`⚠️ [warn] wallet=${sWal.public_key} => lamToken=0 => skip`);
      continue;
    }

    let srcKP: Keypair;
    try {
      srcKP = keypairFromHex64(sWal.private_key);
    } catch (err) {
      console.log("❌ [error] decode kp =>", err);
      continue;
    }

    
    let destTokenAcc;
    try {
      destTokenAcc = await getOrCreateAssociatedTokenAccount(
        connection,
        srcKP,
        mintPub,
        destPublicKey
      );
      console.log("🌐 [info] Destination ATA =>", destTokenAcc.address.toBase58());
    } catch (err) {
      console.log("❌ [error] unifyTokens => getOrCreateATA(dest) =>", err);
      continue;
    }

    
    let sourceTokenAcc;
    try {
      sourceTokenAcc = await getOrCreateAssociatedTokenAccount(
        connection,
        srcKP,
        mintPub,
        srcKP.publicKey
      );
    } catch (err) {
      console.log("❌ [error] unifyTokens => getOrCreateATA(source) =>", err);
      continue;
    }

    let success = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const sig = await transfer(
          connection,
          srcKP,
          sourceTokenAcc.address,
          destTokenAcc.address,
          srcKP.publicKey,
          lamToken
        );
        console.log(`✅ [SUCCESS unifyTokens] => https://solscan.io/tx/${sig}`);
        sWal.tokenAccounts[unifyMintAddr].uiBalance = 0;
        success = true;
        break;
      } catch (err: any) {
        if (err?.message?.includes("insufficient funds")) {
          console.log(`⚠️ [warn] insufficient funds => skip wallet=${sWal.public_key}`);
          break;
        }
        const isBlockhashError =
          String(err).includes("TransactionExpiredBlockheightExceededError") ||
          String(err).includes("503 Service Unavailable");

        if (isBlockhashError) {
          console.log(`⚠️ [warn] Attempt #${attempt}: blockhash or 503 => retry..`);
          await new Promise((resolve) => setTimeout(resolve, 1500));
          continue;
        }
        if (err.name === "SendTransactionError") {
          console.log("❌ [error] SendTransactionError =>", err.transactionMessage);
          if (Array.isArray(err.transactionLogs)) {
            console.log("=== logs ===");
            err.transactionLogs.forEach((l: string) => console.log(l));
            console.log("============");
          }
          break;
        }
        console.log("❌ [error] unifyTokens => transfer =>", err);
        break;
      }
    }
    if (!success) {
      console.log(`⚠️ [warn] unifyTokens => skipping source wallet ${sWal.public_key}`);
    }
  }

  saveDB(db);
  await updateSolBalanceUI(db);
  await updateTokenHoldingsUI(db);

  console.log("🛎 [info] unifyTokens => done");
}





async function createWalletUI(db: DBInterface) {
  const { num } = await inquirer.prompt({
    type: "input",
    name: "num",
    message: "How many wallets to create?",
    default: "1",
  });
  const howMany = parseInt(num, 10) || 1;
  for (let i = 0; i < howMany; i++) {
    const kp = Keypair.generate();
    const hexStr = Buffer.from(kp.secretKey).toString("hex");
    const w: WalletEntry = {
      private_key: hexStr,
      public_key: kp.publicKey.toBase58(),
      balance: 0,
      tokenAccounts: {},
    };
    db.wallets.push(w);
    console.log(`✨ Created wallet => ${w.public_key} | pk(HEX)=${w.private_key}`);
  }
  saveDB(db);
}










async function getTokenPriceUsd(mint: string): Promise<number> {
  
  if (mint === "So11111111111111111111111111111111111111112") {
    const solPrice = await getSolPriceUsd(); 
    return solPrice ?? 0;
  }
  
  try {
    
    const url = `https://io.dexscreener.com/u/v1/tokens/solana:${mint}`;
    const resp = await fetch(url);
    if (resp.status !== 200) {
      return 0;
    }
    const data = await resp.json();
    
    if (data.pairs && data.pairs.length > 0) {
      return data.pairs[0].priceUsd || 0;
    }
  } catch (err) {
    
  }
  
  return 0;
}


async function listWalletsUI(db: DBInterface) {
  await updateSolBalanceUI(db);
  await updateTokenHoldingsUI(db);

  if (!db.wallets.length) {
    console.log("⚠️ [warn] No wallets in DB");
    return;
  }

  
  const allMints = new Set<string>();
  for (const w of db.wallets) {
    if (w.tokenAccounts) {
      for (const mintAddr of Object.keys(w.tokenAccounts)) {
        allMints.add(mintAddr);
      }
    }
  }

  
  const tokenPrices: Record<string, number> = {};
  for (const mint of allMints) {
    
    const p = await getTokenPriceUsd(mint); 
    tokenPrices[mint] = p || 0;
  }

  
  const timeStr = new Date().toLocaleTimeString();
  const solP = await getSolPriceUsd();
  console.log(`[ListWallets] 🕒 Time => ${timeStr} | 💰 SOL => $${solP?.toFixed(3) || "???"}`);

  console.log("🚀=== WALLET TABLE ===🚀\n");
  console.log(
    "🪐  INDEX |          WALLET-PUBKEY          |   SOL-Balance  |      PK(HEX partial)      "
  );
  console.log("-----------------------------------------------------------------------------------------");

  
  db.wallets.forEach((w, idx) => {
    const indexStr = String(idx + 1).padEnd(5);
    const pubKeyShort = w.public_key;
    const balanceStr = w.balance.toFixed(3).padStart(7);
    const pkHexShort = w.private_key.slice(0, 16) + "...";

    console.log(
      `  #${indexStr}| ${pubKeyShort.padEnd(30)}| ${balanceStr.padEnd(14)}| ${pkHexShort}`
    );

    
    if (w.tokenAccounts) {
      const tokenAddrs = Object.keys(w.tokenAccounts);
      if (tokenAddrs.length > 0) {
        console.log(`     ~ Tokens =>`);
        for (const tk of tokenAddrs) {
          const tacc = w.tokenAccounts[tk];
          if (!tacc) continue;

          
          const coinMatch = db.coins.find(c => c.mint === tacc.mint);
          
          const tokenName = coinMatch ? coinMatch.name : "UnknownToken";
          const mintShort = tacc.mint;  

          
          const priceUsd = tokenPrices[tacc.mint] || 0;
          const priceStr = priceUsd.toFixed(6); 
          const totalValueUsd = tacc.uiBalance * priceUsd;
          const totalValueStr = totalValueUsd.toFixed(2); 

          
          
          
          console.log(
            `         ${tokenName} => mint=${mintShort}, Bal=${tacc.uiBalance.toFixed(3)}`
            + ` | Price=$${priceStr} => (~$${totalValueStr} total)`
          );
        }
      }
    }
  });

  console.log("\n🌟 (End of Wallet Table)\n");
}





async function updateSolBalanceUI(db: DBInterface) {
  console.log("🔄 [info] Updating SOL balances..");

  for (const w of db.wallets) {
    let success = false;
    let attempt = 0;
    while (!success && attempt < 3) {
      attempt++;
      try {
        const lam = await connection.getBalance(new PublicKey(w.public_key));
        w.balance = lam / 1e9;
        success = true;
      } catch (e: any) {
        console.log(`❌ [error] getBalance (attempt #${attempt}) => ${w.public_key}`, e?.message || e);
        if (String(e).includes("429 Too Many Requests")) {
          console.log("⚠️ [warn] 429 => Too many requests => will retry..");
          await new Promise((r) => setTimeout(r, 10000));
        } else if (String(e).includes("503 Service Unavailable")) {
          console.log("⚠️ [warn] 503 => will retry..");
          await new Promise((r) => setTimeout(r, 2000));
        } else {
          break;
        }
      }
    }
    if (!success) {
      console.log(`❌ [error] getBalance => skip wallet ${w.public_key}`);
    }
  }

  saveDB(db);
  console.log("✅ [info] Done updating balances");
}




let pendingTxs: {
  txid: string;
  phase: "buy" | "sell" | "unify-tokens" | "unify-sol" | "distribute" | "burn";
}[] = [];

async function sendTransactionAsync(vtx: VersionedTransaction, phase: "buy" | "sell", walletKP: Keypair) {
  try {
    vtx.sign([walletKP]);
    const rawTx = vtx.serialize();
    const txid = await connection.sendRawTransaction(rawTx, {
      skipPreflight: true,
      maxRetries: 3,
    });
    pendingTxs.push({ txid, phase });
    console.log(`[ASYNC] TX sent => ${txid} (phase=${phase})`);
  } catch (err) {
    console.log(`❌ [error] sendTransactionAsync(${phase}) =>`, err);
  }
}

async function checkPendingTransactions(conn: Connection) {
  if (pendingTxs.length === 0) return;
  const txList = [...pendingTxs];
  const BATCH_SIZE = 20;
  for (let i = 0; i < txList.length; i += BATCH_SIZE) {
    const batch = txList.slice(i, i + BATCH_SIZE);
    const txids = batch.map((b) => b.txid);

    try {
      const statusResp = await conn.getSignatureStatuses(txids, {
        searchTransactionHistory: true,
      });
      statusResp.value.forEach((st, idx) => {
        const original = batch[idx];
        if (!original) return;
        if (st?.confirmationStatus === "confirmed" || st?.confirmationStatus === "finalized") {
          console.log(`✅ [CONFIRMED] => ${original.txid} (phase=${original.phase})`);
          pendingTxs = pendingTxs.filter((p) => p.txid !== original.txid);
        } else if (st?.err) {
          console.log(`❌ [TX-ERROR] => ${original.txid}, err=`, st.err);
          pendingTxs = pendingTxs.filter((p) => p.txid !== original.txid);
        } else {
          
        }
      });
    } catch (err) {
      console.log("❌ [error] checkPendingTransactions =>", err);
    }
  }
}

function startBackgroundChecker(conn: Connection) {
  setInterval(() => {
    checkPendingTransactions(conn);
  }, 10_000);
}




async function doBuyPhaseAsync(
  db: DBInterface,
  walletIndices: number[],
  coin: CoinEntry,
  buyMode: string,
  buyMin: number,
  buyMax: number,
  buyStatic: number,
  parallelTxBuy: number
) {
  const limit = pLimit(parallelTxBuy);
  const tasks: Array<() => Promise<void>> = [];

  for (const wIdx of walletIndices) {
    const wal = db.wallets[wIdx];
    const bal = wal.balance;
    const leftoverPercent = bal * 0.01;
    let neededForAccCreation = 0;
    const hasTokenAcc = wal.tokenAccounts && wal.tokenAccounts[coin.mint];
    if (!hasTokenAcc) {
      neededForAccCreation = 0.005;
    }
    const leftoverTotal = Math.max(leftoverPercent, 0.001) + neededForAccCreation;
    const usable = bal - leftoverTotal;
    if (usable <= 0) {
      console.log(`⚠️ [warn] skip wallet=${wal.public_key}, not enough SOL`);
      continue;
    }

    let spend = 0.0;
    if (buyMode === "random") {
      const rnd = randomBetween(buyMin, buyMax);
      spend = rnd > usable ? usable : rnd;
    } else if (buyMode === "max") {
      spend = usable;
    } else if (buyMode === "static") {
      spend = buyStatic > usable ? usable : buyStatic;
    }
    if (spend < 0.000001) {
      console.log(`⚠️ [warn] skip wallet=${wal.public_key}, spend < 0.000001`);
      continue;
    }

    const taskFn = async () => {
      let kp: Keypair;
      try {
        kp = keypairFromHex64(wal.private_key);
      } catch (e) {
        console.log("❌ [error] decode kp =>", e);
        return;
      }

      const rawSol = Math.floor(spend * 1e9);
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const SOL_MINT = "So11111111111111111111111111111111111111112";
          const quote = await getJupiterQuote(SOL_MINT, coin.mint, rawSol);
          if (!quote?.routePlan || quote.routePlan.length === 0) {
            console.log("⚠️ [warn] no route => skip wallet");
            break;
          }
          const swapResp = await jupiterSwapTransaction(quote, kp.publicKey.toBase58());
          if (!swapResp?.swapTransaction) {
            console.log("❌ [error] no swapTx => skip");
            break;
          }

          const buf = Buffer.from(swapResp.swapTransaction, "base64");
          let vtx = VersionedTransaction.deserialize(buf);
          const latestBH = await connection.getLatestBlockhash();
          vtx.message.recentBlockhash = latestBH.blockhash;

          console.log(`[Buy] attempt #${attempt} => wallet=${wal.public_key}, spend=${spend.toFixed(3)}`);
          await sendTransactionAsync(vtx, "buy", kp);
          break;
        } catch (e: any) {
          console.log(`[error] buy attempt #${attempt} => wallet=${wal.public_key}`, e?.message || e);
          if (String(e).includes("TransactionExpiredBlockheightExceededError") || String(e).includes("503 Service Unavailable")) {
            console.log("⚠️ [warn] blockhash or 503 => retry..");
            await new Promise((resolve) => setTimeout(resolve, 2000));
          } else {
            break;
          }
        }
      }
    };
    tasks.push(() => limit(taskFn));
  }

  await Promise.all(tasks.map((t) => t()));
  await updateSolBalanceUI(db);
  await updateTokenHoldingsUI(db);
}




async function doSellPhaseAsync(
  db: DBInterface,
  walletIndices: number[],
  coin: CoinEntry,
  sellMode: string,
  sellPct: number,
  sellMinToken: number,
  sellMaxToken: number,
  parallelTxSell: number
) {
  const MIN_SOL_LEFTOVER = 0.001;
  const limit = pLimit(parallelTxSell);
  const tasks: Array<() => Promise<void>> = [];

  for (const wIdx of walletIndices) {
    const wal = db.wallets[wIdx];

    const taskFn = async () => {
      if (!wal.tokenAccounts || !wal.tokenAccounts[coin.mint]) {
        console.log(`⚠️ [warn] wallet=${wal.public_key} => no token => skip`);
        return;
      }
      const tAcc = wal.tokenAccounts[coin.mint];
      const lamBal = tAcc.lamBalance;
      if (lamBal <= 0) {
        console.log(`⚠️ [warn] wallet=${wal.public_key} => zero token => skip`);
        return;
      }
      if (wal.balance < MIN_SOL_LEFTOVER) {
        console.log(`⚠️ [warn] wallet=${wal.public_key} => below leftover => skip`);
        return;
      }

      let sellAmtLam = 0;
      if (sellMode === "all") {
        sellAmtLam = lamBal;
      } else if (sellMode === "pct") {
        sellAmtLam = Math.floor(lamBal * (sellPct / 100));
      } else if (sellMode === "random") {
        const dec = tAcc.decimals || coin.decimals || 6;
        const lamMin = Math.floor(sellMinToken * 10 ** dec);
        const lamMax = Math.floor(sellMaxToken * 10 ** dec);
        if (lamBal < lamMin) {
          console.log(`⚠️ [warn] not enough tokens => skip wallet=${wal.public_key}`);
          return;
        }
        let randomLam = lamMin + Math.floor(Math.random() * (lamMax - lamMin + 1));
        if (randomLam > lamBal) {
          randomLam = lamBal;
        }
        sellAmtLam = randomLam;
      }

      if (sellAmtLam > lamBal) sellAmtLam = lamBal;
      if (sellAmtLam <= 0) {
        console.log(`⚠️ [warn] => sellAmt=0 => skip wallet`);
        return;
      }

      let kp: Keypair;
      try {
        kp = keypairFromHex64(wal.private_key);
      } catch (e) {
        console.log("❌ [error] => decode kp =>", e);
        return;
      }

      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          console.log(`[Sell] Attempt #${attempt} => wallet=${wal.public_key}, lamSell=${sellAmtLam}`);
          const inputMint = coin.mint;
          const outputMint = "So11111111111111111111111111111111111111112";
          const quote = await getJupiterQuote(inputMint, outputMint, sellAmtLam);
          if (!quote?.routePlan || quote.routePlan.length === 0) {
            console.log("⚠️ [warn] no route => skip");
            break;
          }
          const swapResp = await jupiterSwapTransaction(quote, kp.publicKey.toBase58());
          if (!swapResp?.swapTransaction) {
            console.log("❌ [error] no swapTx => skip");
            break;
          }

          const buf = Buffer.from(swapResp.swapTransaction, "base64");
          let vtx = VersionedTransaction.deserialize(buf);
          const latestBH = await connection.getLatestBlockhash();
          vtx.message.recentBlockhash = latestBH.blockhash;

          await sendTransactionAsync(vtx, "sell", kp);
          break;
        } catch (err: any) {
          console.log(`[error] SELL => attempt #${attempt}, wallet=${wal.public_key}`, err?.message || err);
          if (String(err).includes("TransactionExpiredBlockheightExceededError") || String(err).includes("503 Service Unavailable")) {
            console.log("⚠️ [warn] blockhash or 503 => retry..");
            await new Promise((r) => setTimeout(r, 2000));
          } else {
            break;
          }
        }
      }
    };
    tasks.push(() => limit(taskFn));
  }

  await Promise.all(tasks.map((t) => t()));
  await updateSolBalanceUI(db);
  await updateTokenHoldingsUI(db);
}




async function updateTokenHoldingsUI(db: DBInterface) {
  console.log("🔄 [info] Updating token holdings..");
  for (const w of db.wallets) {
    let success = false;
    let attempt = 0;
    while (!success && attempt < 3) {
      attempt++;
      try {
        w.tokenAccounts = {};

        const pub = new PublicKey(w.public_key);
        const resp = await connection.getParsedTokenAccountsByOwner(pub, {
          programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
        });

        for (const item of resp.value) {
          const data = item.account.data as SplParsedData;
          if (!data?.parsed) continue;
          const info = data.parsed.info;
          if (!info) continue;

          const lamBalance = parseInt(info.tokenAmount.amount, 10);
          const dec = info.tokenAmount.decimals || 0;
          if (lamBalance > 0) {
            w.tokenAccounts[info.mint] = {
              tokenAddress: item.pubkey.toBase58(),
              lamBalance,
              uiBalance: lamBalance / 10 ** dec,
              mint: info.mint,
              decimals: dec,
              metaName: undefined,
            };

            const meta = await fetchTokenMetadata(info.mint);
            if (meta && meta.name) {
              w.tokenAccounts[info.mint].metaName = meta.name;
              console.log(
                `🪐 [metadata] Found: ${meta.name} => ${meta.symbol || "??"} => icon:${meta.icon || "??"}`
              );
            }
          }
        }
        success = true;
      } catch (e: any) {
        console.log(`❌ [error] updateTokenHoldingsUI (attempt #${attempt}) => wallet=${w.public_key}`, e.message || e);
        if (String(e).includes("429 Too Many Requests")) {
          console.log("⚠️ [warn] 429 => will retry..");
          await new Promise((resolve) => setTimeout(resolve, 10000));
        } else if (String(e).includes("503 Service Unavailable")) {
          console.log("⚠️ [warn] 503 => will retry..");
          await new Promise((resolve) => setTimeout(resolve, 2000));
        } else {
          break;
        }
      }
    }
    if (!success) {
      console.log(`❌ [error] => skipping token update for wallet ${w.public_key}`);
    }
  }

  saveDB(db);
  console.log("✅ [info] Done updating token holdings");
}




async function manageCoinsUI(db: DBInterface) {
  while (true) {
    console.log("\n=== Coins Management ===");
    console.log("[1] List coins");
    console.log("[2] Add new coin");
    console.log("[3] Edit coin");
    console.log("[4] Delete coin");
    console.log("[5] Return");
    const { ch } = await inquirer.prompt({
      type: "input",
      name: "ch",
      message: "Choice?",
      default: "1",
    });
    if (ch === "1") {
      if (!db.coins.length) {
        console.log("⚠️ [warn] No coins in DB");
      } else {
        console.log("=== COIN LIST ===");
        db.coins.forEach((c, i) => {
          console.log(`${i + 1}) ${c.name} => ${c.mint}, decimals=${c.decimals || "??"}`);
        });
      }
    } else if (ch === "2") {
      const { val: name } = await inquirer.prompt({ type: "input", name: "val", message: "Coin name?" });
      const { val: mint } = await inquirer.prompt({ type: "input", name: "val", message: "Mint address?" });
      const { val: dec } = await inquirer.prompt({
        type: "input",
        name: "val",
        message: "Decimals?",
        default: "6",
      });
      db.coins.push({ name, mint, decimals: parseInt(dec, 10) || 6 });
      saveDB(db);
      console.log("✅ [info] coin added");
    } else if (ch === "3") {
      if (!db.coins.length) {
        console.log("⚠️ [warn] no coins => cannot edit");
        continue;
      }
      db.coins.forEach((c, i) => {
        console.log(`${i + 1}) ${c.name} => mint=${c.mint}`);
      });
      const { idxStr } = await inquirer.prompt({
        type: "input",
        name: "idxStr",
        message: "Which coin index?",
        default: "1",
      });
      const idx = parseInt(idxStr, 10) - 1;
      if (idx < 0 || idx >= db.coins.length) {
        console.log("❌ [error] invalid index");
        continue;
      }
      const coin = db.coins[idx];
      const { val: newName } = await inquirer.prompt({
        type: "input",
        name: "val",
        message: `New name? (old=${coin.name})`,
        default: coin.name,
      });
      coin.name = newName;
      const { val: newMint } = await inquirer.prompt({
        type: "input",
        name: "val",
        message: `New mint? (old=${coin.mint})`,
        default: coin.mint,
      });
      coin.mint = newMint;
      const { val: newDec } = await inquirer.prompt({
        type: "input",
        name: "val",
        message: `Decimals? (old=${coin.decimals || 6})`,
        default: (coin.decimals || 6).toString(),
      });
      coin.decimals = parseInt(newDec, 10) || 6;
      saveDB(db);
      console.log("✅ [info] coin updated");
    } else if (ch === "4") {
      if (!db.coins.length) {
        console.log("⚠️ [warn] no coins => cannot delete");
        continue;
      }
      db.coins.forEach((c, i) => {
        console.log(`${i + 1}) ${c.name} => ${c.mint}`);
      });
      const { ddStr } = await inquirer.prompt({
        type: "input",
        name: "ddStr",
        message: "Which coin index to delete?",
        default: "1",
      });
      const dd = parseInt(ddStr, 10) - 1;
      if (dd < 0 || dd >= db.coins.length) {
        console.log("❌ [error] invalid index");
        continue;
      }
      console.log(`🗑 [info] Deleting => ${db.coins[dd].name}`);
      db.coins.splice(dd, 1);
      saveDB(db);
    } else if (ch === "5") {
      break;
    } else {
      console.log("❌ [error] invalid choice");
    }
  }
}




async function waitForAllBuysToFinish() {
  await new Promise((res) => setTimeout(res, 5000));
  const MAX_WAIT = 12;
  let waited = 0;
  while (true) {
    await checkPendingTransactions(connection);
    const stillBuy = pendingTxs.some((tx) => tx.phase === "buy");
    if (!stillBuy) break;
    if (waited > MAX_WAIT) {
      console.log("⚠️ [warn] waitForAllBuysToFinish => Exceeded max wait => proceed anyway..");
      break;
    }
    await new Promise((res) => setTimeout(res, 3000));
    waited += 3;
  }
  console.log("✅ [info] All BUY TX done or timed-out => continuing..");
}



async function waitForAllSellsToFinish() {
  await new Promise((res) => setTimeout(res, 5000));
  const MAX_WAIT = 12;
  let waited = 0;
  while (true) {
    await checkPendingTransactions(connection);
    const stillBuy = pendingTxs.some((tx) => tx.phase === "sell");
    if (!stillBuy) break;
    if (waited > MAX_WAIT) {
      console.log("⚠️ [warn] waitForAllSellsToFinish => Exceeded max wait => proceed anyway..");
      break;
    }
    await new Promise((res) => setTimeout(res, 3000));
    waited += 3;
  }
  console.log("✅ [info] All SELL TX done or timed-out => continuing..");
}

/**
 * burnTokensUI
 * Ermöglicht das Verbrennen eines bestimmten SPL-Tokens von ausgewählten Wallets.
 */

import {
  createBurnCheckedInstruction,
  createCloseAccountInstruction,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";








async function sendTransactionAsyncBurn(
  tx: Transaction,
  walletKP: Keypair,
  phase: "burn"
) {
  try {
    
    
    const latestBH = await connection.getLatestBlockhash();
    tx.recentBlockhash = latestBH.blockhash;

    
    const sig = await connection.sendTransaction(tx, [walletKP], {
      skipPreflight: true,
      maxRetries: 3,
    });

    
    
    pendingTxs.push({ txid: sig, phase });
    console.log(`[ASYNC] TX sent => ${sig} (phase=${phase})`);
  } catch (err) {
    console.log(`❌ [error] sendTransactionAsyncBurn(${phase}) =>`, err);
  }
}









async function waitForAllBurnsToFinish() {
  
  await new Promise((res) => setTimeout(res, 5000));

  const MAX_WAIT = 20; 
  let waited = 0;

  while (true) {
    await checkPendingTransactions(connection); 
    
    

    
    const stillBurn = pendingTxs.some((tx) => tx.phase === "burn");
    if (!stillBurn) {
      break;
    }

    if (waited > MAX_WAIT) {
      console.log(
        "⚠️ [warn] waitForAllBurnsToFinish => Exceeded max wait => proceed anyway.."
      );
      break;
    }

    
    await new Promise((res) => setTimeout(res, 3000));
    waited += 1;
  }
  console.log("✅ [info] All BURN TX done or timed-out => continuing..");
}



async function burnTokensUI(db: DBInterface) {
  
  if (!db.wallets.length) {
    console.log("❌ [error] No wallets => abort burnTokens");
    return;
  }
  if (!db.coins.length) {
    console.log("⚠️ [warn] No coins => cannot burn => abort");
    return;
  }

  
  const coinChoices = db.coins.map((c, i) => ({
    name: `${c.name} => mint=${c.mint}`,
    value: i,
  }));
  const { coinIdx } = await inquirer.prompt({
    type: "list",
    name: "coinIdx",
    message: "Which SPL-Token do you want to burn?",
    choices: coinChoices,
  });

  const chosenCoin = db.coins[coinIdx];
  const mintPub = new PublicKey(chosenCoin.mint);
  const decimals = chosenCoin.decimals || 6;

  
  const relevantWallets = db.wallets.filter((w) => {
    return (
      w.tokenAccounts &&
      w.tokenAccounts[chosenCoin.mint] &&
      w.tokenAccounts[chosenCoin.mint].uiBalance > 0
    );
  });

  if (!relevantWallets.length) {
    console.log(
      `⚠️ [warn] None of your wallets hold ${chosenCoin.name} => abort burn`
    );
    return;
  }

  
  const walletChoices = relevantWallets.map((w, i) => ({
    name: `(R${i + 1}) ${w.public_key} => has ${
      w.tokenAccounts?.[chosenCoin.mint]?.uiBalance.toFixed(decimals)
    } ${chosenCoin.name}`,
    value: w,
  }));
  const { selectedWallets } = await inquirer.prompt<{
    selectedWallets: WalletEntry[];
  }>([
    {
      type: "checkbox",
      name: "selectedWallets",
      message: `Select the wallet(s) to burn ${chosenCoin.name}:`,
      choices: walletChoices,
    },
  ]);

  if (!selectedWallets.length) {
    console.log("⚠️ [warn] no wallets selected => abort burn");
    return;
  }

  
  const { mode } = await inquirer.prompt({
    type: "list",
    name: "mode",
    message: "How many tokens do you want to burn?",
    choices: [
      { name: "All tokens in each selected wallet", value: "all" },
      { name: "Custom amount", value: "custom" },
    ],
  });

  let customAmount = 0;
  if (mode === "custom") {
    const { amtStr } = await inquirer.prompt({
      type: "input",
      name: "amtStr",
      message: `Enter how many tokens you want to burn (e.g. 10.5)`,
      default: "1",
    });
    customAmount = parseFloat(amtStr);
    if (isNaN(customAmount) || customAmount <= 0) {
      console.log("❌ [error] invalid amount => abort burn");
      return;
    }
  }

  
  const { parallelStr } = await inquirer.prompt({
    type: "input",
    name: "parallelStr",
    message: "How many parallel burn transactions at once? (1..10)",
    default: "3",
  });
  let parallelLimit = parseInt(parallelStr, 10);
  if (isNaN(parallelLimit) || parallelLimit < 1) parallelLimit = 1;
  if (parallelLimit > 10) parallelLimit = 10;

  const limit = pLimit(parallelLimit);
  const tasks: Array<() => Promise<void>> = [];

  
  for (const w of selectedWallets) {
    const tAcc = w.tokenAccounts?.[chosenCoin.mint];
    if (!tAcc || tAcc.uiBalance <= 0) {
      console.log(`⚠️ [warn] wallet=${w.public_key} => no token => skip`);
      continue;
    }

    
    let uiAmountToBurn: number;
    if (mode === "all") {
      uiAmountToBurn = tAcc.uiBalance;
    } else {
      
      if (customAmount > tAcc.uiBalance) {
        console.log(
          `⚠️ [warn] wallet=${w.public_key} => only ${tAcc.uiBalance.toFixed(
            decimals
          )} available; can't burn ${customAmount} => burning all.`
        );
        uiAmountToBurn = tAcc.uiBalance;
      } else {
        uiAmountToBurn = customAmount;
      }
    }

    const lamToBurn = Math.floor(uiAmountToBurn * 10 ** decimals);
    if (lamToBurn <= 0) {
      console.log(`⚠️ [warn] burn amount <= 0 => skip wallet ${w.public_key}`);
      continue;
    }

    
    const burnTask = async () => {
      let kp: Keypair;
      try {
        kp = keypairFromHex64(w.private_key);
      } catch (e) {
        console.log("❌ [error] decode kp =>", e);
        return;
      }

      
      const burnIx = createBurnCheckedInstruction(
        new PublicKey(tAcc.tokenAddress!), 
        mintPub,                           
        kp.publicKey,                      
        lamToBurn,
        decimals,
        [],                                
        TOKEN_PROGRAM_ID
      );

      
      const tx = new Transaction().add(burnIx);

      
      
      
      if (uiAmountToBurn === tAcc.uiBalance) {
        const closeIx = createCloseAccountInstruction(
          new PublicKey(tAcc.tokenAddress!), 
          kp.publicKey, 
          kp.publicKey, 
          []
        );
        tx.add(closeIx);
      }

      
      await sendTransactionAsyncBurn(tx, kp, "burn");

      console.log(
        `[BURN-ASYNC] => wallet=${w.public_key}, burn=${uiAmountToBurn} tokens => TX queued`
      );
    };

    tasks.push(() => limit(burnTask));
  }

  
  await Promise.all(tasks.map((fn) => fn()));

  
  saveDB(db);

  
  await waitForAllBurnsToFinish();

  console.log("🛎 [info] burnTokens => done => all confirmed or timed out.");
}



export async function multiBuyUI(db: DBInterface) {
  if (!db.wallets.length) {
    console.log("❌ [error] No wallets => abort");
    return;
  }
  if (!db.coins.length) {
    console.log("❌ [error] No coins => abort");
    return;
  }

  const wCh = db.wallets.map((w, i) => ({
    name: `${w.public_key} (SOL=${w.balance.toFixed(3)})`,
    value: i,
  }));
  const { wSelected } = await inquirer.prompt([
    {
      type: "checkbox",
      name: "wSelected",
      message: "Select one or more wallets to BUY from:",
      choices: wCh,
    },
  ]);
  if (!wSelected || wSelected.length === 0) {
    console.log("⚠️ [warn] no wallets => abort");
    return;
  }

  const cCh = db.coins.map((c, i) => ({
    name: `${c.name} => mint=${c.mint}`,
    value: i,
  }));
  const { cIdx } = await inquirer.prompt({
    type: "list",
    name: "cIdx",
    message: "Which coin to buy?",
    choices: cCh,
  });
  const coin = db.coins[cIdx];

  const { buyMode } = await inquirer.prompt({
    type: "list",
    name: "buyMode",
    message: "Select Buy Mode:",
    choices: [
      { name: "Random in [min..max]", value: "random" },
      { name: "Max (entire usable)", value: "max" },
      { name: "Static (fixed amount)", value: "static" },
    ],
  });

  let minSol = 0.01;
  let maxSol = 0.05;
  let staticSol = 0.01;

  if (buyMode === "random") {
    const { minVal } = await inquirer.prompt({
      type: "input",
      name: "minVal",
      message: "Minimum SOL per wallet?",
      default: "0.01",
    });
    minSol = parseFloat(minVal) || 0.01;
    const { maxVal } = await inquirer.prompt({
      type: "input",
      name: "maxVal",
      message: "Maximum SOL per wallet?",
      default: "0.05",
    });
    maxSol = parseFloat(maxVal) || 0.05;
    if (maxSol < minSol) {
      maxSol = minSol + 0.05;
    }
  } else if (buyMode === "static") {
    const { staticVal } = await inquirer.prompt({
      type: "input",
      name: "staticVal",
      message: "How many SOL per wallet (fixed)?",
      default: "0.05",
    });
    staticSol = parseFloat(staticVal) || 0.01;
  }

  const { parallelStr } = await inquirer.prompt({
    type: "input",
    name: "parallelStr",
    message: "How many parallel BUY transactions at once? (max=10)",
    default: "2",
  });
  let parallelTx = parseInt(parallelStr, 10);
  if (isNaN(parallelTx) || parallelTx < 1) parallelTx = 1;
  if (parallelTx > 10) parallelTx = 10;

  const { delayStr } = await inquirer.prompt({
    type: "input",
    name: "delayStr",
    message: "Delay in seconds after each BUY tx? (0=none)",
    default: "0",
  });
  const delaySec = parseFloat(delayStr) || 0;

  const limit = pLimit(parallelTx);
  const tasks: Array<() => Promise<void>> = [];

  for (const wIdx of wSelected) {
    const wal = db.wallets[wIdx];
    const leftoverPercent = wal.balance * 0.01;
    let neededForAccCreation = 0;
    const alreadyHasToken = wal.tokenAccounts && wal.tokenAccounts[coin.mint];
    if (!alreadyHasToken) {
      neededForAccCreation = 0.005;
    }
    const leftover = Math.max(leftoverPercent, 0.001) + neededForAccCreation;
    const usable = wal.balance - leftover;
    if (usable <= 0) {
      console.log(
        `⚠️ [warn] not enough => skip wallet=${wal.public_key}, bal=${wal.balance.toFixed(3)}, leftover=${leftover.toFixed(3)}`
      );
      continue;
    }

    let spend = 0;
    if (buyMode === "random") {
      const rnd = randomBetween(minSol, maxSol);
      spend = rnd > usable ? usable : rnd;
    } else if (buyMode === "max") {
      spend = usable;
    } else {
      spend = staticSol > usable ? usable : staticSol;
    }

    if (spend < 0.000001) {
      console.log(`⚠️ [warn] spending < 0.000001 => skip wallet=${wal.public_key}`);
      continue;
    }

    const taskFn = async () => {
      console.log(`\n💸 [multiBuy] => wallet=${wal.public_key}, SOL=${spend.toFixed(3)}, coin=${coin.name}`);

      let kp: Keypair;
      try {
        kp = keypairFromHex64(wal.private_key);
      } catch (e) {
        console.log("❌ [error] => decode kp =>", e);
        return;
      }

      const rawSol = Math.floor(spend * 1e9);
      let success = false;

      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const SOL_MINT = "So11111111111111111111111111111111111111112";
          const quote = await getJupiterQuote(SOL_MINT, coin.mint, rawSol);
          if (!quote?.routePlan || quote.routePlan.length === 0) {
            console.log("⚠️ [warn] no route => skip wallet");
            break;
          }

          const swapResp = await jupiterSwapTransaction(quote, kp.publicKey.toBase58());
          if (!swapResp?.swapTransaction) {
            console.log("❌ [error] no swapTx => skip wallet");
            break;
          }

          const buf = Buffer.from(swapResp.swapTransaction, "base64");
          let vtx = VersionedTransaction.deserialize(buf);
          const latestBH = await connection.getLatestBlockhash();
          vtx.message.recentBlockhash = latestBH.blockhash;
          vtx.sign([kp]);

          console.log(`[info] attempt #${attempt} => sending tx => wallet=${wal.public_key}`);
          const rawTx = vtx.serialize();
          const txid = await connection.sendRawTransaction(rawTx, {
            skipPreflight: true,
            maxRetries: 3,
          });
          console.log("🔗 [info] Tx =>", txid);

          await connection.confirmTransaction(
            {
              blockhash: latestBH.blockhash,
              lastValidBlockHeight: latestBH.lastValidBlockHeight,
              signature: txid,
            },
            "processed"
          );

          console.log(`✅ [SUCCESS] => https://solscan.io/tx/${txid}`);
          success = true;
          break;
        } catch (e: any) {
          console.log(`[error] attempt #${attempt} => wallet=${wal.public_key}`, e?.message || e);
          if (
            String(e).includes("TransactionExpiredBlockheightExceededError") ||
            String(e).includes("503 Service Unavailable")
          ) {
            console.log("⚠️ [warn] blockhash or 503 => retry..");
            await new Promise((resolve) => setTimeout(resolve, 2000));
          } else {
            break;
          }
        }
      }

      if (!success) {
        console.log("❌ [error] => skipping wallet (buy failed)");
      }

      if (delaySec > 0) {
        console.log(`⌛ [info] sleeping ${delaySec}s..`);
        await new Promise((r) => setTimeout(r, delaySec * 1000));
      }
    };
    tasks.push(() => limit(taskFn));
  }

  await Promise.all(tasks.map((t) => t()));
  await updateSolBalanceUI(db);
  await updateTokenHoldingsUI(db);
  saveDB(db);

  console.log("🛎 [info] multiBuy => done (parallel version)");
}




export async function multiSellUI(db: DBInterface) {
  if (!db.wallets.length) {
    console.log("❌ [error] No wallets => abort");
    return;
  }

  const wCh = db.wallets.map((w, i) => ({
    name: `${w.public_key} => SOL=${w.balance.toFixed(3)}, tokens=${Object.keys(w.tokenAccounts || {}).length}`,
    value: i,
  }));
  const { wSelected } = await inquirer.prompt([
    {
      type: "checkbox",
      name: "wSelected",
      message: "Select wallets for multi-SELL (single large TX )",
      choices: wCh,
    },
  ]);
  if (!wSelected || wSelected.length === 0) {
    console.log("⚠️ [warn] none => abort");
    return;
  }

  if (!db.coins.length) {
    console.log("⚠️ [warn] no coins => must add coin first => skip");
    return;
  }
  const cCh = db.coins.map((c, i) => ({
    name: `${c.name} => mint=${c.mint}, dec=${c.decimals || 6}`,
    value: i,
  }));
  const { cIdx } = await inquirer.prompt({
    type: "list",
    name: "cIdx",
    message: "Which coin to SELL?",
    choices: cCh,
  });
  const coin = db.coins[cIdx];
  if (!coin.decimals) coin.decimals = 6;

  const { sellMode } = await inquirer.prompt({
    type: "list",
    name: "sellMode",
    message: "Select SELL Mode:",
    choices: [
      { name: "Sell ALL tokens", value: "all" },
      { name: "Sell a certain PERCENTAGE of each wallet's tokens", value: "pct" },
      { name: "Sell a RANDOM amount [min..max]", value: "random" },
    ],
  });

  let pctVal = 50;
  let minToken = 0.1;
  let maxToken = 1.0;

  if (sellMode === "pct") {
    const { pctStr } = await inquirer.prompt({
      type: "input",
      name: "pctStr",
      message: "Which percentage of tokens do you want to sell? (0..100)",
      default: "50",
    });
    pctVal = parseFloat(pctStr) || 50;
    if (pctVal < 0) pctVal = 0;
    if (pctVal > 100) pctVal = 100;
  } else if (sellMode === "random") {
    const { minVal } = await inquirer.prompt({
      type: "input",
      name: "minVal",
      message: "Min tokens to sell per wallet?",
      default: "0.1",
    });
    minToken = parseFloat(minVal) || 0.1;

    const { maxVal } = await inquirer.prompt({
      type: "input",
      name: "maxVal",
      message: "Max tokens to sell per wallet?",
      default: "1.0",
    });
    maxToken = parseFloat(maxVal) || 1.0;
    if (maxToken < minToken) {
      maxToken = minToken + 1.0;
    }
  }

  const { slippageStr } = await inquirer.prompt({
    type: "input",
    name: "slippageStr",
    message: "Enter slippage in % (high enough for  approach)?",
    default: "2",
  });
  let slippagePct = parseFloat(slippageStr) || 5;
  if (slippagePct < 0) slippagePct = 1;
  if (slippagePct > 20) slippagePct = 20;
  
  

  const { parallelStr } = await inquirer.prompt({
    type: "input",
    name: "parallelStr",
    message: "How many parallel SELLs at once? (max=10)",
    default: "2",
  });
  let parallelTx = parseInt(parallelStr, 10);
  if (isNaN(parallelTx) || parallelTx < 1) parallelTx = 1;
  if (parallelTx > 10) parallelTx = 10;

  const { delayStr } = await inquirer.prompt({
    type: "input",
    name: "delayStr",
    message: "Delay (s) after each wallet's SELL?",
    default: "0",
  });
  const delaySec = parseFloat(delayStr) || 0;

  console.log("🔄 [info] Refreshing SOL & Token balances before SELL...");
  await updateSolBalanceUI(db);
  await updateTokenHoldingsUI(db);

  
  await doSellPhaseAsync(db, wSelected, coin, sellMode, pctVal, minToken, maxToken, parallelTx);

  console.log("🛎 [info] multiSell => done (single big TX approach + 3 retries per wallet)");
}




export async function distributeSolUI(db: DBInterface) {
  if (!db.wallets.length) {
    console.log("❌ [error] no wallets => abort");
    return;
  }

  
  await updateSolBalanceUI(db);

  
  const wCh = db.wallets.map((w, i) => ({
    name: `${i+1}) ${w.public_key} => SOL=${w.balance.toFixed(3)}`,
    value: i
  }));
  const { senderIdx } = await inquirer.prompt({
    type: "list",
    name: "senderIdx",
    message: "Which wallet is the SENDER?",
    choices: wCh
  });
  const sender = db.wallets[senderIdx];

  
  const { totVal } = await inquirer.prompt({
    type: "input",
    name: "totVal",
    message: "How many SOL to distribute in total?",
    default: "0.5"
  });
  let totalSol = parseFloat(totVal);
  if (isNaN(totalSol) || totalSol <= 0) {
    console.log("❌ [error] => invalid => abort");
    return;
  }

  
  const usable = sender.balance * 0.99;
  if (totalSol > usable) {
    console.log(`⚠️ [warn] you exceed safe-limit => capping to ${usable.toFixed(3)}`);
    totalSol = usable;
  }

  
  const others = db.wallets
    .map((w, i) => ({
      name: `${i+1}) ${w.public_key} => SOL=${w.balance.toFixed(3)}`,
      value: i
    }))
    .filter((o) => o.value !== senderIdx);

  const { recSelected } = await inquirer.prompt<{ recSelected: number[] }>([
    {
      type: "checkbox",
      name: "recSelected",
      message: "Which wallets get SOL?",
      choices: others
    }
  ]);
  if (!recSelected || recSelected.length === 0) {
    console.log("⚠️ [warn] none => abort");
    return;
  }

  
  const n = recSelected.length;
  let portion = totalSol / n;

  
  let kp: Keypair;
  try {
    kp = keypairFromHex64(sender.private_key);
  } catch (e) {
    console.log("❌ [error] => kp decode =>", e);
    return;
  }

  
  for (const rid of recSelected) {
    const rec = db.wallets[rid];
    console.log(`💸 Dist => ${portion.toFixed(3)} SOL => ${rec.public_key}`);

    let success = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const sig = await systemTransferSol(kp, rec.public_key, portion);
        if (!sig) {
          throw new Error("systemTransferSol => null sig");
        }
        console.log(`✅ [SUCCESS] => https://solscan.io/tx/${sig}`);
        success = true;
        break;
      } catch (err: any) {
        const errMsg = String(err);
        console.log(`[error] distribute => attempt #${attempt} =>`, errMsg);
        if (errMsg.includes("503 Service Unavailable")) {
          console.log("⚠️ [warn] Possibly a transient error => will retry..");
        } else {
          break;
        }
      }
    }
    if (!success) {
      console.log("❌ [error] => skip wallet for distribution");
    }
  }

  console.log("🛎 [info] distribution => done");
}





export async function unifySolUI(db: DBInterface) {
  
  await updateSolBalanceUI(db);

  if (!db.wallets.length) {
    console.log("❌ [error] no wallets => abort unifySol");
    return;
  }

  
  const destChoice = await inquirer.prompt({
    type: "list",
    name: "destChoice",
    message: "Destination: pick from DB or external pubkey?",
    choices: [
      { name: "Pick from DB wallets", value: "db" },
      { name: "Enter external pubkey", value: "ext" },
    ],
  });

  let destPubkey: PublicKey | null = null;
  let destLabel = "";

  if (destChoice.destChoice === "db") {
    
    const wCh = db.wallets.map((w, i) => ({
      name: `${i + 1}) ${w.public_key} => SOL=${w.balance.toFixed(3)}`,
      value: i,
    }));
    const { targetIdx } = await inquirer.prompt({
      type: "list",
      name: "targetIdx",
      message: "Which wallet is DESTINATION?",
      choices: wCh,
    });
    const dest = db.wallets[targetIdx];
    destPubkey = new PublicKey(dest.public_key);
    destLabel = dest.public_key;
  } else {
    
    const { extPub } = await inquirer.prompt({
      type: "input",
      name: "extPub",
      message: "Enter external destination pubkey:",
      default: "",
    });
    if (!extPub) {
      console.log("❌ [error] => no pubkey => abort unifySolUI");
      return;
    }
    try {
      destPubkey = new PublicKey(extPub.trim());
      destLabel = destPubkey.toBase58();
    } catch (e) {
      console.log("❌ [error] => invalid external pubkey => abort unifySolUI");
      return;
    }
  }

  
  const walletChoices = db.wallets.map((w, i) => ({
    name: `${i + 1}) ${w.public_key} => SOL=${w.balance.toFixed(3)}`,
    value: i,
  }));
  const { sourceIdxs } = await inquirer.prompt<{ sourceIdxs: number[] }>([
    {
      type: "checkbox",
      name: "sourceIdxs",
      message: "Select SOURCE wallets (unify SOL from these wallets):",
      choices: walletChoices,
    },
  ]);

  if (!sourceIdxs.length) {
    console.log("⚠️ [warn] No source wallets selected => abort unifySol");
    return;
  }

  
  const MIN_LEFTOVER = 0.002;

  
  for (const sIdx of sourceIdxs) {
    const w = db.wallets[sIdx];
    if (w.balance <= MIN_LEFTOVER) {
      console.log(`⚠️ [warn] wallet ${w.public_key} => below leftover => skip`);
      continue;
    }
    const safeAmount = w.balance - MIN_LEFTOVER;
    if (safeAmount < 0) {
      console.log(`⚠️ [warn] skip => can't unify from ${w.public_key}, insufficient above rent`);
      continue;
    }

    let kp: Keypair;
    try {
      kp = keypairFromHex64(w.private_key);
    } catch (err) {
      console.log("❌ [error] => decode kp =>", err);
      continue;
    }

    console.log(`🔹 unifySOL => from=${w.public_key} => to=${destLabel}, amt=${safeAmount.toFixed(3)}`);

    let success = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const sig = await systemTransferSol(kp, destPubkey.toBase58(), safeAmount);
        if (!sig) {
          throw new Error("systemTransferSol => null sig");
        }
        console.log(`✅ [SUCCESS unifySOL] => https://solscan.io/tx/${sig}`);
        w.balance -= safeAmount;
        success = true;
        break;
      } catch (err: any) {
        const errMsg = String(err);
        console.log(`[error] unifySOL => attempt #${attempt} =>`, errMsg);

        const isBlockhashError =
          errMsg.includes("TransactionExpiredBlockheightExceededError") ||
          errMsg.includes("503 Service Unavailable");
        if (isBlockhashError) {
          console.log(`⚠️ [warn] Attempt #${attempt}: blockhash or 503 => retry..`);
          await new Promise((resolve) => setTimeout(resolve, 1500));
          continue;
        }
        break;
      }
    }
    if (!success) {
      console.log("❌ [error] unifySOL => transfer fail => skip wallet");
    }
  }

  
  await updateSolBalanceUI(db);
  saveDB(db);
  console.log("🛎 [info] unifySol => done");
}



async function dashboardUI(db: DBInterface) {
  console.log("\n💫 [info] Starting the Dashboard... Press 'q' to quit.\n");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let exitFlag = false;
  rl.on("line", (input) => {
    if (input.trim().toLowerCase() === "q") {
      exitFlag = true;
      rl.close();
    }
  });

  while (!exitFlag) {
    await updateSolBalanceUI(db);
    await updateTokenHoldingsUI(db);

    const solPrice = await getSolPriceUsd();
    console.clear();

    console.log("===========================================================");
    console.log("                X  V  O  L  U  M  E   DASHBOARD            ");
    console.log("===========================================================");
    console.log(`🕒 Time => ${new Date().toLocaleTimeString()}   |   💰 SOL => $${solPrice?.toFixed(3) || "???"}`);
    console.log("-----------------------------------------------------------\n");

    
    const priceArray = [
      (solPrice || 100) * 0.97,
      (solPrice || 100) * 1.02,
      (solPrice || 100) * 0.99,
      (solPrice || 100) * 1.01,
    ];
    console.log("== ASCII Price Graph (SOL) ==");
    console.log(renderAsciiGraph(priceArray));
    console.log("");

    console.log("======== WALLET OVERVIEW ========");
    console.log("| Index | Public Key (short)         |    SOL    | #Tokens |");
    console.log("|-------|----------------------------|-----------|---------|");

    db.wallets.forEach((w, i) => {
      const indexStr = String(i + 1).padStart(5);
      const pubShort = w.public_key.slice(0, 16) + "...";
      const solStr = w.balance.toFixed(3).padStart(7);
      const tokenCount = w.tokenAccounts ? Object.keys(w.tokenAccounts).length : 0;
      const tokenStr = String(tokenCount).padStart(3);

      console.log(`|  ${indexStr} | ${pubShort.padEnd(28)}| ${solStr}  |   ${tokenStr}   |`);
    });
    console.log("");

    console.log("(Press 'q' + [enter] to exit Dashboard..)\n");
    await new Promise((r) => setTimeout(r, 15000));
  }

  console.log("🏁 [info] Dashboard => exit");
}

function renderAsciiGraph(prices: number[]): string {
  if (!prices.length) return "No data for graph";
  const minP = Math.min(...prices);
  const maxP = Math.max(...prices);
  const lines = 5;
  let out = "";
  for (let row = 0; row < lines; row++) {
    const level = maxP - ((maxP - minP) / (lines - 1)) * row;
    let lineStr = "";
    prices.forEach((p) => {
      if (p >= level) {
        lineStr += " *  ";
      } else {
        lineStr += "    ";
      }
    });
    out += level.toFixed(2).padStart(6) + " | " + lineStr + "\n";
  }
  out += "       " + "[Time ->]\n";
  return out;
}




async function optionsMenu(db: DBInterface) {
  while (true) {
    console.log("\n=== OPTIONS MENU ===");
    console.log("[1] Manage Wallets (List/Import/Export/Delete)");
    console.log("[3] Change RPC URL");
    console.log("[4] Back to Main");

    const { ch } = await inquirer.prompt({
      type: "input",
      name: "ch",
      message: "Choice?",
      default: "1",
    });

    if (ch === "1") {
      await manageWalletsMenu(db);
    } else if (ch === "3") {
      const { newRpc } = await inquirer.prompt({
        type: "input",
        name: "newRpc",
        message: "Enter new RPC URL:",
        default: configData.rpcUrl,
      });
      configData.rpcUrl = newRpc;
      saveConfig(configData);
      reloadConnection();
    } else if (ch === "4") {
      break;
    } else {
      console.log("❌ [error] invalid choice =>", ch);
    }
  }
}




async function manageWalletsMenu(db: DBInterface) {
  while (true) {
    console.log("\n=== MANAGE WALLETS ===");
    console.log("[1] List wallets");
    console.log("[2] Import wallet (Phantom PK/Base58 or HEX)");
    console.log("[3] Export wallet (show PK)");
    console.log("[4] Delete wallet");
    console.log("[5] Return to Options Menu");

    const { ch } = await inquirer.prompt({
      type: "input",
      name: "ch",
      message: "Choice?",
      default: "1",
    });

    if (ch === "1") {
      listWalletsUI(db);
    } else if (ch === "2") {
      await importWalletUI(db);
    } else if (ch === "3") {
      await exportWalletUI(db);
    } else if (ch === "4") {
      await deleteWalletUI(db);
    } else if (ch === "5") {
      break;
    } else {
      console.log("❌ [error] Invalid choice =>", ch);
    }
  }
}




async function importWalletUI(db: DBInterface) {
  const { pkStr } = await inquirer.prompt({
    type: "input",
    name: "pkStr",
    message: "Paste your Private Key (Phantom Export / Base58) or 128-char HEX:",
  });

  let kp: Keypair | null = null;
  try {
    if (/^[0-9A-Fa-f]+$/.test(pkStr) && pkStr.length === 128) {
      const raw = Buffer.from(pkStr, "hex");
      if (raw.length !== 64) {
        console.log("❌ [error] After hex decode => not 64 bytes => abort");
        return;
      }
      kp = Keypair.fromSecretKey(raw);
    } else {
      const raw = bs58.decode(pkStr);
      kp = Keypair.fromSecretKey(raw);
    }

    if (kp) {
      db.wallets.push({
        private_key: Buffer.from(kp.secretKey).toString("hex"),
        public_key: kp.publicKey.toBase58(),
        balance: 0,
        tokenAccounts: {},
      });
      saveDB(db);
      console.log(`✅ [info] Imported wallet => pub=${kp.publicKey.toBase58()}`);
    }
  } catch (err) {
    console.log("❌ [error] importWallet =>", err);
  }
}




async function exportWalletUI(db: DBInterface) {
  if (!db.wallets.length) {
    console.log("⚠️ [warn] No wallets => cannot export");
    return;
  }
  db.wallets.forEach((w, i) => {
    console.log(`${i + 1}) ${w.public_key} (bal=${w.balance.toFixed(3)})`);
  });
  const { idxStr } = await inquirer.prompt({
    type: "input",
    name: "idxStr",
    message: "Which wallet to export (index)?",
    default: "1",
  });
  const idx = parseInt(idxStr, 10) - 1;
  if (idx < 0 || idx >= db.wallets.length) {
    console.log("❌ [error] invalid index => abort");
    return;
  }
  const wal = db.wallets[idx];

  console.log("\n=== EXPORT WALLET ===");
  console.log(`Public Key => ${wal.public_key}`);
  console.log(`Private Key (HEX 128) => ${wal.private_key}`);
  try {
    const raw = Buffer.from(wal.private_key, "hex");
    const base58Key = bs58.encode(raw);
    console.log(`Private Key (Base58) => ${base58Key}`);
  } catch {}
  console.log("================================\n");
}




async function deleteWalletUI(db: DBInterface) {
  if (!db.wallets.length) {
    console.log("⚠️ [warn] no wallets => can't delete");
    return;
  }

  
  const walletChoices = db.wallets.map((w, i) => ({
    name: `#${i + 1} => ${w.public_key}, bal=${w.balance.toFixed(3)}`,
    value: i, 
  }));

  
  const { killIndexes } = await inquirer.prompt<{
    killIndexes: number[];
  }>([
    {
      type: "checkbox",
      name: "killIndexes",
      message: "Which wallet(s) do you want to delete? (Select multiple with [space])",
      choices: walletChoices,
    },
  ]);

  if (!killIndexes.length) {
    console.log("⚠️ [warn] No wallets selected => skip deletion");
    return;
  }

  
  
  killIndexes.sort((a, b) => b - a);

  
  for (const idx of killIndexes) {
    console.log(`🗑 [info] Deleting => ${db.wallets[idx].public_key}`);
    db.wallets.splice(idx, 1);
  }

  
  saveDB(db);
  console.log("✅ [info] Done => Deleted selected wallets.");
}




export async function multiBuySellCycleUI(db: DBInterface) {
  if (!db.wallets.length) {
    console.log("❌ [error] No wallets => abort");
    return;
  }
  if (!db.coins.length) {
    console.log("❌ [error] No coins => abort");
    return;
  }

  const cCh = db.coins.map((c, i) => ({
    name: `${c.name} => mint=${c.mint}`,
    value: i,
  }));
  const { cIdx } = await inquirer.prompt({
    type: "list",
    name: "cIdx",
    message: "Which coin to trade (buy+sell)?",
    choices: cCh,
  });
  const coin = db.coins[cIdx];

  const wCh = db.wallets.map((w, i) => ({
    name: `${w.public_key} (SOL=${w.balance.toFixed(3)})`,
    value: i,
  }));
  const { wSelectedBuy } = await inquirer.prompt([
    {
      type: "checkbox",
      name: "wSelectedBuy",
      message: "Select wallet(s) to participate in BUY phase:",
      choices: wCh,
    },
  ]);
  if (!wSelectedBuy || wSelectedBuy.length === 0) {
    console.log("⚠️ [warn] no wallets for BUY => abort");
    return;
  }
  const { wSelectedSell } = await inquirer.prompt([
    {
      type: "checkbox",
      name: "wSelectedSell",
      message: "Select wallet(s) to participate in SELL phase:",
      choices: wCh,
    },
  ]);
  if (!wSelectedSell || wSelectedSell.length === 0) {
    console.log("⚠️ [warn] no wallets for SELL => abort");
    return;
  }

  const { cycleStr } = await inquirer.prompt({
    type: "input",
    name: "cycleStr",
    message: "How many (Buy+Sell) cycles do you want to run?",
    default: "3",
  });
  const cycleCount = parseInt(cycleStr, 10) || 1;

  const { delayBuySellStr } = await inquirer.prompt({
    type: "input",
    name: "delayBuySellStr",
    message: "Delay in seconds AFTER a BUY before starting SELL?",
    default: "10",
  });
  const delayBuySell = parseFloat(delayBuySellStr) || 10;

  const { delayCycleStr } = await inquirer.prompt({
    type: "input",
    name: "delayCycleStr",
    message: "Delay in seconds AFTER a SELL before next cycle?",
    default: "30",
  });
  const delayCycle = parseFloat(delayCycleStr) || 30;

  const { buyMode } = await inquirer.prompt({
    type: "list",
    name: "buyMode",
    message: "Select BUY Mode:",
    choices: [
      { name: "Random in [min..max]", value: "random" },
      { name: "Max (all usable)", value: "max" },
      { name: "Static (fixed amount)", value: "static" },
    ],
  });
  let buyMin = 0.01,
    buyMax = 0.05,
    buyStatic = 0.01;
  if (buyMode === "random") {
    const { minVal } = await inquirer.prompt({
      type: "input",
      name: "minVal",
      message: "BUY: Minimum SOL per wallet?",
      default: "0.01",
    });
    buyMin = parseFloat(minVal) || 0.01;
    const { maxVal } = await inquirer.prompt({
      type: "input",
      name: "maxVal",
      message: "BUY: Maximum SOL per wallet?",
      default: "0.05",
    });
    buyMax = parseFloat(maxVal) || 0.05;
    if (buyMax < buyMin) {
      buyMax = buyMin + 0.05;
    }
  } else if (buyMode === "static") {
    const { staticVal } = await inquirer.prompt({
      type: "input",
      name: "staticVal",
      message: "BUY: How many SOL per wallet (fixed)?",
      default: "0.05",
    });
    buyStatic = parseFloat(staticVal) || 0.05;
  }

  const { sellMode } = await inquirer.prompt({
    type: "list",
    name: "sellMode",
    message: "Select SELL Mode:",
    choices: [
      { name: "Sell ALL tokens", value: "all" },
      { name: "Sell certain PERCENTAGE of tokens", value: "pct" },
      { name: "Sell RANDOM [min..max] tokens", value: "random" },
    ],
  });
  let sellPct = 50.0,
    sellMinToken = 0.1,
    sellMaxToken = 1.0;

  if (sellMode === "pct") {
    const { pctStr } = await inquirer.prompt({
      type: "input",
      name: "pctStr",
      message: "Which percentage of tokens do you want to sell? (0..100)",
      default: "50",
    });
    sellPct = parseFloat(pctStr) || 50;
    if (sellPct < 0) sellPct = 0;
    if (sellPct > 100) sellPct = 100;
  } else if (sellMode === "random") {
    const { sminVal } = await inquirer.prompt({
      type: "input",
      name: "sminVal",
      message: "SELL: Min tokens to sell per wallet?",
      default: "0.1",
    });
    sellMinToken = parseFloat(sminVal) || 0.1;
    const { smaxVal } = await inquirer.prompt({
      type: "input",
      name: "smaxVal",
      message: "SELL: Max tokens to sell per wallet?",
      default: "1.0",
    });
    sellMaxToken = parseFloat(smaxVal) || 1.0;
    if (sellMaxToken < sellMinToken) {
      sellMaxToken = sellMinToken + 1.0;
    }
  }

  const { parallelBuyStr } = await inquirer.prompt({
    type: "input",
    name: "parallelBuyStr",
    message: "How many parallel BUY transactions? (max=10)",
    default: "2",
  });
  let parallelTxBuy = parseInt(parallelBuyStr, 10);
  if (isNaN(parallelTxBuy) || parallelTxBuy < 1) parallelTxBuy = 1;
  if (parallelTxBuy > 10) parallelTxBuy = 10;

  const { parallelSellStr } = await inquirer.prompt({
    type: "input",
    name: "parallelSellStr",
    message: "How many parallel SELL transactions? (max=10)",
    default: "2",
  });
  let parallelTxSell = parseInt(parallelSellStr, 10);
  if (isNaN(parallelTxSell) || parallelTxSell < 1) parallelTxSell = 1;
  if (parallelTxSell > 10) parallelTxSell = 10;

  for (let cycleIndex = 1; cycleIndex <= cycleCount; cycleIndex++) {
    console.log(`\n==== [Cycle #${cycleIndex}/${cycleCount}] ====\n`);



    console.log(`\n🔹 Starting BUY phase (cycle #${cycleIndex})...`);
    await doBuyPhaseAsync(db, wSelectedBuy, coin, buyMode, buyMin, buyMax, buyStatic, parallelTxBuy);

    await waitForAllBuysToFinish();
    await updateTokenHoldingsUI(db);

    console.log(`\n🔻 Starting SELL phase (cycle #${cycleIndex})...`);
    await doSellPhaseAsync(db, wSelectedSell, coin, sellMode, sellPct, sellMinToken, sellMaxToken, parallelTxSell);

    await waitForAllSellsToFinish();
    await updateTokenHoldingsUI(db);
    if (cycleIndex < cycleCount && delayCycle > 0) {
      console.log(`\n⌛ [info] Waiting ${delayCycle}s before next cycle...`);
      await new Promise((res) => setTimeout(res, delayCycle * 1000));
    }
  }

  console.log("\n🏁 [info] multiBuySellCycle => all cycles done");

}




async function mainMenu() {
  

  await displayStartBanner();

  const db = loadDB();
  startBackgroundChecker(connection);

  while (true) {
    const timeStr = new Date().toLocaleTimeString();
    const solP = await getSolPriceUsd();
    console.log("");
    console.log("             =========== X V O L U M E (by t30d0r) ===========");
    console.log(`       🕒 Time => ${timeStr}  |  💰 SOL => $${solP?.toFixed(3) || "???"} `);
    console.log("----------------------------------------------------------------------------------------");
    console.log("----------------------------------------------------------------------------------------");
    if (configData.rpcUrl === "https://api.mainnet-beta.solana.com") {
      console.log("");
      console.log("=====================================================================");
      console.log(" WARNING: You are still using the default RPC (api.mainnet-beta.solana.com) ");
      console.log("          You will need to use a faster/more reliable RPC, ");
      console.log("          e.g. QuickNode or another Solana provider.");
      console.log("=====================================================================");
      console.log("");
    }
    console.log("1) Create wallets         📝");
    console.log("2) Show wallets           📜");
    console.log("3) Manage coins           ⚙️");
    console.log("4) Multi-Wallet-Buy       🛒");
    console.log("5) Multi-Wallet-Sell      🛒");
    console.log("6) Multi-Buy-Sell-Cycle   🛒");
    console.log("7) Unify SOL              🔗");
    console.log("8) Unify Coins            🌍");
    console.log("9) Distribute SOL         🚚");
    console.log("10) Burn / Reclaim SOL    🔥");      
    console.log("11) Dashboard             📊");
    console.log("O) Options (License/RPC/Wallet Mgmt)");
    console.log("X) Exit                 🔚");

    const { choice } = await inquirer.prompt({
      type: "input",
      name: "choice",
      message: "Pick an option: M/2/3/4/5/6/7/8/9/O/X ?",
      default: "M",
    });

    const ch = choice.trim().toUpperCase();
    if (ch === "M") {
      
    } else if (ch === "1") {
      await createWalletUI(db);
    } else if (ch === "2") {
      await listWalletsUI(db);
    } else if (ch === "3") {
      await manageCoinsUI(db);
    } else if (ch === "4") {
      await multiBuyUI(db);
    } else if (ch === "5") {
      await multiSellUI(db);
    } else if (ch === "9") {
      await distributeSolUI(db);
    } else if (ch === "7") {
      await unifySolUI(db);
    } else if (ch === "8") {
      await unifyTokensUI(db);
    } else if (ch === "11") {
      await dashboardUI(db);
    } else if (ch === "6") {
      await multiBuySellCycleUI(db);
    } else if (ch === "O") {
      await optionsMenu(db);
      
    } 
    if (ch === "10") {
      await burnTokensUI(db);    
    } else if (ch === "X") {
      console.log("👋 [info] Exiting..");
      break;
    } else {
      console.log("❌ [error] invalid choice =>", ch);
    }
  }
}


if (require.main === module) {
  mainMenu().catch((e) => {
    console.error("💥 [FATAL]", e);
  });
}
