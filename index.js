// index.js
import { ethers } from "ethers";
import "dotenv/config";
import fs from "fs";
import chalk from "chalk";
import blessed from "blessed";
import contrib from "blessed-contrib";

// === Config ===
const rpcList = [
  "https://carrot.megaeth.com/rpc",
  "https://rpc.testnet.megaeth.com",
  "https://testnet.megaeth.io/rpc"
];
const chainId = 6342;
const gasLimit = 21000;
const maxFee = ethers.parseUnits("0.0025", "gwei");
const maxPriorityFee = ethers.parseUnits("0.001", "gwei");

const privateKeys = fs.readFileSync("private_keys.txt", "utf-8").trim().split("\n");
const targetAddress = fs.readFileSync("target_address.txt", "utf-8").trim();

if (!ethers.isAddress(targetAddress)) throw new Error("Invalid target address");

// === Terminal UI ===
const screen = blessed.screen();
const grid = new contrib.grid({ rows: 12, cols: 12, screen });

const logBox = grid.set(0, 0, 6, 8, blessed.log, {
  label: "Logs",
  tags: true,
  border: { type: "line" },
  scrollable: true,
});

const donut = grid.set(0, 8, 6, 4, contrib.donut, {
  label: "Success vs Failed",
  radius: 16,
  arcWidth: 4,
  yPadding: 2,
  data: [
    { percent: 0, label: "Success", color: "green" },
    { percent: 0, label: "Failed", color: "red" },
  ],
});

const walletTable = grid.set(6, 0, 6, 12, contrib.table, {
  keys: true,
  fg: "white",
  label: "Wallet Summary",
  columnWidth: [20, 14, 10, 46],
});

screen.key(["escape", "q", "C-c"], () => process.exit(0));
screen.render();

// === RPC Fallback ===
let provider;
for (let rpc of rpcList) {
  try {
    provider = new ethers.JsonRpcProvider(rpc);
    await provider.getBlockNumber();
    logBox.log(`{green-fg}Connected to:${rpc}{/}`);
    break;
  } catch (e) {
    logBox.log(`{red-fg}Failed to connect:${rpc}{/}`);
  }
}
if (!provider) throw new Error("All RPC connections failed");

// === Main Logic ===
let success = 0;
let failed = 0;
let walletData = [];

async function sendETH(pk, index) {
  try {
    const wallet = new ethers.Wallet(pk, provider);
    const address = await wallet.getAddress();
    const balance = await provider.getBalance(address);
    const ethBal = parseFloat(ethers.formatEther(balance));

    logBox.log(`Wallet ${index + 1}: {cyan-fg}${address}{/}`);
    logBox.log(`Balance: {yellow-fg}${ethBal}{/} ETH`);

    if (ethBal <= 0.001) {
      logBox.log(`{red-fg}Skipping - insufficient balance{/}`);
      walletData.push([address, ethBal.toFixed(4), "❌ Skipped", "-"]);
      failed++;
      return;
    }

    const amount = ethBal - 0.001;
    const nonce = await provider.getTransactionCount(address);

    const tx = await wallet.sendTransaction({
      to: targetAddress,
      value: ethers.parseEther(amount.toFixed(8)),
      gasLimit,
      maxFeePerGas: maxFee,
      maxPriorityFeePerGas: maxPriorityFee,
      nonce,
      chainId,
      type: 2,
    });

    logBox.log(`{blue-fg}Sent TX:{/} https://megaexplorer.xyz/tx/${tx.hash}`);
    const receipt = await tx.wait();
    logBox.log(`{green-fg}Confirmed in block ${receipt.blockNumber}{/}`);
    success++;
    walletData.push([address, ethBal.toFixed(4), "✅ Success", tx.hash]);
  } catch (e) {
    logBox.log(`{red-fg}Error:${e.message}{/}`);
    failed++;
    walletData.push(["--", "--", "❌ Failed", "--"]);
  }

  donut.setData([
    { percent: (success / privateKeys.length) * 100, label: "Success", color: "green" },
    { percent: (failed / privateKeys.length) * 100, label: "Failed", color: "red" },
  ]);
  walletTable.setData({
    headers: ["Wallet", "Balance (ETH)", "Status", "TX Hash"],
    data: walletData,
  });
  screen.render();
}

async function run() {
  logBox.log(`{bold}Target Address:{/} ${targetAddress}`);
  for (let i = 0; i < privateKeys.length; i++) {
    await sendETH(privateKeys[i], i);
  }
  logBox.log(`\n{bold}Done!{/}`);
  screen.render();
}

run();
