// megaeth-faucet-sender-test/index.js
import figlet from 'figlet';
import { ethers } from 'ethers';
import fs from 'fs';
import chalk from 'chalk';
import ora from 'ora';
import blessed from 'blessed';
import contrib from 'blessed-contrib';
import cliProgress from 'cli-progress';
import os from 'os';
import cluster from 'node:cluster';
import { setInterval } from 'timers/promises';

// ====== Load Configuration ======
const provider = new ethers.JsonRpcProvider('https://carrot.megaeth.com/rpc');
const chainId = 6342;

const privateKeys = fs.readFileSync('private_keys.txt', 'utf-8')
  .split('\n')
  .map(line => line.trim())
  .filter(Boolean);
const targetAddress = fs.readFileSync('target_address.txt', 'utf-8').trim();
const totalWallets = privateKeys.length;

const numCPUs = os.cpus().length;

// ====== Terminal UI Setup ======
const screen = blessed.screen();
const grid = new contrib.grid({ rows: 12, cols: 12, screen });
const logBox = grid.set(8, 0, 4, 12, blessed.log, { label: 'Live Logs', border: 'line', scrollable: true });
const donut = grid.set(0, 0, 4, 4, contrib.donut, { label: 'Success/Fail', radius: 16 });
const line = grid.set(0, 4, 4, 8, contrib.line, { label: 'ETH Flow' });
const table = grid.set(4, 0, 4, 12, contrib.table, {
  keys: true,
  label: 'Wallet Balances',
  columnWidth: [25, 15, 12, 18, 14]
});

let ethFlowData = { x: [], y: [] };
let success = 0, failed = 0, skipped = 0;
screen.render();

function clusterWallets(keys) {
  const clusters = {};
  for (const key of keys) {
    const prefix = key.slice(2, 6);
    if (!clusters[prefix]) clusters[prefix] = [];
    clusters[prefix].push(key);
  }
  return Object.values(clusters);
}

function updateDashboard() {
  donut.setData([
    { label: 'Success', percent: (success / totalWallets) * 100 || 0, color: 'green' },
    { label: 'Fail', percent: (failed / totalWallets) * 100 || 0, color: 'red' },
    { label: 'Skipped', percent: (skipped / totalWallets) * 100 || 0, color: 'yellow' },
  ]);
  line.setData([{ title: 'ETH Sent', x: ethFlowData.x, y: ethFlowData.y }]);
  screen.render();
}

async function processWallet(pk, index) {
  const wallet = new ethers.Wallet(pk, provider);
  const address = await wallet.getAddress();
  const spinner = ora(`🔐 Processing ${address}`).start();
  const now = new Date().toLocaleString();

  try {
    const balance = await provider.getBalance(address);
    if (balance < ethers.parseEther('0.002')) {
      skipped++;
      logBox.log(`⚠ Skipped [${address}] - Low balance`);
      table.rows.push([address, '0', 'Skipped', '-', now]);
      return;
    }

    const gas = await provider.estimateGas({ to: targetAddress, from: address });
    const feeData = await provider.getFeeData();
    const gasCost = gas * (feeData.maxFeePerGas || feeData.gasPrice);
    const amount = balance - gasCost;

    const tx = await wallet.sendTransaction({
      to: targetAddress,
      value: amount,
      maxFeePerGas: feeData.maxFeePerGas,
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
      gasLimit: gas
    });

    await tx.wait();
    success++;
    ethFlowData.x.push(index.toString());
    ethFlowData.y.push(Number(ethers.formatEther(amount)).toFixed(4));
    logBox.log(chalk.green(`✔ ${now} | ${address} | ${ethers.formatEther(amount)} ETH | ${tx.hash} | Success`));
    table.rows.push([address, ethers.formatEther(amount), 'Success', tx.hash, now]);
  } catch (err) {
    failed++;
    logBox.log(chalk.red(`✖ ${now} | ${address} | Error: ${err.message}`));
    table.rows.push([address, '-', 'Failed', '-', now]);
  }

  spinner.stop();
  updateDashboard();
}

async function autoRefresh(intervalSec = 30) {
  for await (const _ of setInterval(intervalSec * 1000)) {
    updateDashboard();
  }
}

console.log(chalk.cyan(figlet.textSync('MEGA ETH')));
console.log(chalk.green(`🚀 Starting MEGA ETH Consolidation`));
console.log(`📌 Chain ID: ${chainId}`);
console.log(`🎯 Target Address: ${targetAddress}`);
console.log(`🔑 Wallets to process: ${totalWallets}\n`);
console.log(chalk.green(`✅ Connected to ${provider.connection.url}`));

const clusters = clusterWallets(privateKeys);
const progressBar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
progressBar.start(totalWallets, 0);

(async () => {
  autoRefresh(15); // Refresh dashboard every 15 seconds

  if (cluster.isPrimary) {
    let index = 0;
    for (let i = 0; i < numCPUs; i++) {
      cluster.fork();
    }

    cluster.on('message', (_, msg) => {
      if (msg.done) progressBar.update(msg.count);
    });

  } else {
    let count = 0;
    for (let i = cluster.worker.id - 1; i < clusters.length; i += numCPUs) {
      const clusterGroup = clusters[i];
      for (let pk of clusterGroup) {
        count++;
        await processWallet(pk, count);
        process.send?.({ done: true, count });
      }
    }
    progressBar.stop();
    logBox.log(`\n✨ Worker ${cluster.worker.id} Done!`);
  }
})();

screen.key(['escape', 'q', 'C-c'], () => process.exit(0));
