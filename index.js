import { ethers } from "ethers";
import fs from "fs";
import dotenv from "dotenv";
import blessed from "blessed";
import contrib from "blessed-contrib";

dotenv.config();

const RPC_ENDPOINTS = [
  "https://carrot.megaeth.com/rpc",
  "https://rpc.testnet.megaeth.com",
  "https://testnet.megaeth.io/rpc",
];

let provider;
for (const rpc of RPC_ENDPOINTS) {
  try {
    provider = new ethers.JsonRpcProvider(rpc);
    await provider.getBlockNumber();
    console.log(`Connected to ${rpc}`);
    break;
  } catch {
    console.log(`Failed to connect to ${rpc}`);
  }
}

if (!provider) throw new Error("Unable to connect to any RPC");

const targetAddress = fs.readFileSync("target_address.txt", "utf-8").trim();
const privateKeys = fs.readFileSync("private_keys.txt", "utf-8")
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean);

if (!ethers.isAddress(targetAddress)) throw new Error("Invalid target address");

const chainId = 6342;
const maxFeePerGas = ethers.parseUnits("0.0025", "gwei");
const maxPriorityFeePerGas = ethers.parseUnits("0.001", "gwei");

// Terminal UI
const screen = blessed.screen();
const grid = new contrib.grid({ rows: 12, cols: 12, screen });

const logBox = grid.set(0, 0, 6, 6, contrib.log, {
  label: "Real-time Logs",
  fg: "green",
  selectedFg: "green"
});

const donut = grid.set(0, 6, 6, 6, contrib.donut, {
  label: "Success / Failed",
  radius: 16,
  arcWidth: 4,
  yPadding: 2,
  data: []
});

const walletTable = grid.set(6, 0, 5, 12, contrib.table, {
  keys: true,
  fg: "white",
  label: "Wallet Status",
  columnWidth: [42, 12, 15, 20]
});

const exitInfo = grid.set(11, 0, 1, 12, blessed.box, {
  content: "Press 'q' or Ctrl+C to exit",
  style: { fg: 'cyan' }
});

screen.key(['q', 'C-c'], function () {
  return process.exit(0);
});

let success = 0, failed = 0;
const tableData = [];

async function getBalance(address) {
  const balance = await provider.getBalance(address);
  return Number(ethers.formatEther(balance));
}

async function sendETH(privateKey, index) {
  const wallet = new ethers.Wallet(privateKey, provider);
  const address = wallet.address;
  logBox.log(`\n[${index + 1}] Wallet: ${address}`);

  try {
    const balance = await getBalance(address);
    logBox.log(`Balance: ${balance.toFixed(6)} ETH`);

    if (balance <= 0.001) {
      logBox.log("Skipping - insufficient balance");
      failed++;
      tableData.push([address, "0", "Failed", "Insufficient"]);
      return;
    }

    const amount = balance - 0.001;
    const nonce = await provider.getTransactionCount(address);

    const tx = await wallet.sendTransaction({
      to: targetAddress,
      value: ethers.parseEther(amount.toFixed(6)),
      nonce,
      gasLimit: 21000,
      maxFeePerGas,
      maxPriorityFeePerGas,
      chainId,
      type: 2
    });

    logBox.log(`TX Hash: ${tx.hash}`);
    tableData.push([address, amount.toFixed(6), "Success", tx.hash]);
    success++;
  } catch (err) {
    logBox.log(`Error: ${err.message}`);
    failed++;
    tableData.push([address, "0", "Failed", err.message.slice(0, 15)]);
  }

  walletTable.setData({
    headers: ["Address", "Amount", "Status", "Info"],
    data: tableData
  });

  donut.setData([
    { percent: success / privateKeys.length * 100, label: "Success", color: "green" },
    { percent: failed / privateKeys.length * 100, label: "Failed", color: "red" },
  ]);

  screen.render();
}

async function run() {
  logBox.log("Starting MEGA ETH Consolidator...");
  for (let i = 0; i < privateKeys.length; i++) {
    await sendETH(privateKeys[i], i);
  }
  logBox.log("\nAll wallets processed.");
  logBox.log(`Total Success: ${success}`);
  logBox.log(`Total Failed: ${failed}`);
  screen.render();
}

run();
