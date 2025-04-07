import figlet from 'figlet';
import { ethers } from 'ethers';
import fs from 'fs';
import chalk from 'chalk';
import ora from 'ora';
import blessed from 'blessed';
import contrib from 'blessed-contrib';
import cliProgress from 'cli-progress';
import os from 'os';
import cluster from 'cluster';

// ====== Load Configuration ======
const rpcUrl = 'https://carrot.megaeth.com/rpc';
const provider = new ethers.JsonRpcProvider(rpcUrl);
const chainId = 6342;

// Read files with error handling
let privateKeys = [];
let targetAddress = '';
try {
  privateKeys = fs.readFileSync('private_keys.txt', 'utf-8')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
  targetAddress = fs.readFileSync('target_address.txt', 'utf-8').trim();
} catch (err) {
  console.error(chalk.red('Error reading input files:'), err.message);
  process.exit(1);
}

const totalWallets = privateKeys.length;
if (totalWallets === 0) {
  console.error(chalk.red('No private keys found in private_keys.txt'));
  process.exit(1);
}

const numCPUs = os.cpus().length;

// ====== Terminal UI Setup ======
const screen = blessed.screen();
const grid = new contrib.grid({ rows: 12, cols: 12, screen });
const logBox = grid.set(8, 0, 4, 12, blessed.log, { 
  label: 'Live Logs', 
  border: 'line', 
  scrollable: true 
});
const donut = grid.set(0, 0, 4, 4, contrib.donut, { 
  label: 'Success/Fail', 
  radius: 16 
});
const line = grid.set(0, 4, 4, 8, contrib.line, { 
  label: 'ETH Flow' 
});
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
    const balanceEth = ethers.formatEther(balance);
    
    if (balance < ethers.parseEther('0.002')) {
      skipped++;
      logBox.log(`⚠ Skipped [${address}] - Low balance (${balanceEth} ETH)`);
      table.rows.push([address, balanceEth, 'Skipped', '-', now]);
      spinner.fail(`Skipped (Low balance: ${balanceEth} ETH)`);
      return;
    }

    const feeData = await provider.getFeeData();
    const gasEstimate = await provider.estimateGas({
      to: targetAddress,
      from: address,
      value: balance - (feeData.maxFeePerGas * 21000n) // Leave some for gas
    });

    const gasCost = gasEstimate * (feeData.maxFeePerGas || feeData.gasPrice);
    const amount = balance - gasCost;

    if (amount <= 0n) {
      skipped++;
      logBox.log(`⚠ Skipped [${address}] - Insufficient balance after gas`);
      table.rows.push([address, balanceEth, 'Skipped', '-', now]);
      spinner.fail('Skipped (Insufficient after gas)');
      return;
    }

    const tx = await wallet.sendTransaction({
      to: targetAddress,
      value: amount,
      maxFeePerGas: feeData.maxFeePerGas,
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
      gasLimit: gasEstimate
    });

    const receipt = await tx.wait();
    if (receipt.status === 1) {
      success++;
      const amountEth = ethers.formatEther(amount);
      ethFlowData.x.push(index.toString());
      ethFlowData.y.push(Number(amountEth));
      logBox.log(chalk.green(`✔ ${now} | ${address} | ${amountEth} ETH | ${tx.hash} | Success`));
      table.rows.push([address, amountEth, 'Success', tx.hash, now]);
      spinner.succeed(`Sent ${amountEth} ETH`);
    } else {
      failed++;
      logBox.log(chalk.red(`✖ ${now} | ${address} | Transaction failed`));
      table.rows.push([address, balanceEth, 'Failed', tx.hash, now]);
      spinner.fail('Transaction failed');
    }
  } catch (err) {
    failed++;
    logBox.log(chalk.red(`✖ ${now} | ${address} | Error: ${err.message}`));
    table.rows.push([address, '-', 'Failed', '-', now]);
    spinner.fail(err.message);
  }

  updateDashboard();
}

console.log(chalk.cyan(figlet.textSync('MEGA ETH')));
console.log(chalk.green(`🚀 Starting MEGA ETH Consolidation`));
console.log(`📌 Chain ID: ${chainId}`);
console.log(`🎯 Target Address: ${targetAddress}`);
console.log(`🔑 Wallets to process: ${totalWallets}\n`);

// Verify connection
provider.getBlockNumber()
  .then(() => console.log(chalk.green(`✅ Connected to ${rpcUrl}`)))
  .catch(err => {
    console.error(chalk.red(`❌ Connection failed: ${err.message}`));
    process.exit(1);
  });

const clusters = clusterWallets(privateKeys);
const progressBar = new cliProgress.SingleBar({
  format: 'Progress |{bar}| {percentage}% | {value}/{total} wallets',
  barCompleteChar: '\u2588',
  barIncompleteChar: '\u2591',
}, cliProgress.Presets.shades_classic);
progressBar.start(totalWallets, 0);

(async () => {
  if (cluster.isPrimary) {
    let completed = 0;
    
    // Fork workers
    for (let i = 0; i < Math.min(numCPUs, clusters.length); i++) {
      cluster.fork();
    }

    cluster.on('message', (worker, msg) => {
      if (msg.done) {
        completed += msg.count;
        progressBar.update(completed);
        
        if (completed >= totalWallets) {
          progressBar.stop();
          console.log(chalk.green('\n✨ All workers completed!'));
          setTimeout(() => process.exit(0), 3000);
        }
      }
    });

    cluster.on('exit', (worker, code, signal) => {
      console.log(chalk.yellow(`Worker ${worker.process.pid} exited`));
    });
  } else {
    let count = 0;
    const workerId = cluster.worker.id;
    const startIdx = workerId - 1;
    
    try {
      for (let i = startIdx; i < clusters.length; i += numCPUs) {
        const clusterGroup = clusters[i];
        for (const pk of clusterGroup) {
          count++;
          await processWallet(pk, count);
          process.send?.({ done: true, count });
        }
      }
    } catch (err) {
      console.error(chalk.red(`Worker ${workerId} error:`), err);
    } finally {
      process.send?.({ done: true, count });
    }
  }
})();

screen.key(['escape', 'q', 'C-c'], () => process.exit(0));
