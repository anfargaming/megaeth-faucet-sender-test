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

// ====== Configuration ======
const config = {
  rpcUrl: 'https://carrot.megaeth.com/rpc',
  chainId: 6342,
  minBalance: '0.002', // Minimum balance to process (ETH)
  gasBuffer: 1.2, // 20% gas buffer
  maxWorkers: os.cpus().length,
  refreshInterval: 15000 // Dashboard refresh in ms
};

// ====== Initialize ======
let provider;
let privateKeys = [];
let targetAddress = '';
let screen, grid, logBox, donut, line, table;
let ethFlowData = { x: [], y: [] };
let success = 0, failed = 0, skipped = 0;
let progressBar;

// ====== Helper Functions ======
function loadFiles() {
  try {
    privateKeys = fs.readFileSync('private_keys.txt', 'utf-8')
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean);
      
    targetAddress = fs.readFileSync('target_address.txt', 'utf-8').trim();
    
    if (privateKeys.length === 0) throw new Error('No private keys found');
    if (!ethers.isAddress(targetAddress)) throw new Error('Invalid target address');
    
    return true;
  } catch (err) {
    console.error(chalk.red('Initialization failed:'), err.message);
    return false;
  }
}

function clusterWallets(keys) {
  const clusters = {};
  keys.forEach(key => {
    const prefix = key.slice(2, 6); // Cluster by key prefix
    clusters[prefix] = clusters[prefix] || [];
    clusters[prefix].push(key);
  });
  return Object.values(clusters);
}

function initUI() {
  screen = blessed.screen({
    smartCSR: true,
    dockBorders: true,
    fullUnicode: true,
    warnings: true
  });

  // Error handlers
  screen.program.on('error', err => console.error('Terminal error:', err));
  screen.on('error', err => console.error('Screen error:', err));

  grid = new contrib.grid({ rows: 12, cols: 12, screen });
  
  logBox = grid.set(8, 0, 4, 12, blessed.log, {
    label: ' Live Logs ',
    border: { type: 'line' },
    style: { fg: 'white', border: { fg: 'cyan' }},
    scrollable: true
  });

  donut = grid.set(0, 0, 4, 4, contrib.donut, {
    label: ' Status ',
    radius: 16,
    arcWidth: 8,
    data: [
      { label: 'Success', percent: 0, color: 'green' },
      { label: 'Failed', percent: 0, color: 'red' },
      { label: 'Skipped', percent: 0, color: 'yellow' }
    ]
  });

  line = grid.set(0, 4, 4, 8, contrib.line, {
    label: ' ETH Flow ',
    showLegend: true,
    legend: { width: 12 }
  });

  table = grid.set(4, 0, 4, 12, contrib.table, {
    label: ' Wallet Balances ',
    columnWidth: [25, 15, 12, 18, 14],
    columnSpacing: 2,
    interactive: true
  });

  // Key bindings
  screen.key(['escape', 'q', 'C-c'], gracefulShutdown);
}

function updateDashboard() {
  donut.setData([
    { label: 'Success', percent: (success / privateKeys.length) * 100 || 0, color: 'green' },
    { label: 'Failed', percent: (failed / privateKeys.length) * 100 || 0, color: 'red' },
    { label: 'Skipped', percent: (skipped / privateKeys.length) * 100 || 0, color: 'yellow' }
  ]);

  line.setData([{
    title: 'ETH Sent',
    x: ethFlowData.x,
    y: ethFlowData.y,
    style: { line: 'green' }
  }]);

  screen.render();
}

function gracefulShutdown() {
  try {
    // Stop all workers
    if (cluster.isPrimary && cluster.workers) {
      for (const id in cluster.workers) {
        cluster.workers[id].kill();
      }
    }
    
    // Destroy UI
    screen.destroy();
    
    // Stop progress bar if exists
    if (progressBar) progressBar.stop();
    
  } catch (err) {
    console.error('Shutdown error:', err);
  } finally {
    process.exit(0);
  }
}

async function processWallet(pk, index) {
  const wallet = new ethers.Wallet(pk, provider);
  const address = await wallet.getAddress();
  const spinner = ora(`Processing ${address}`).start();
  const now = new Date().toLocaleString();

  try {
    // Check balance
    const balance = await provider.getBalance(address);
    const balanceEth = ethers.formatEther(balance);
    const minBalanceWei = ethers.parseEther(config.minBalance);

    if (balance < minBalanceWei) {
      skipped++;
      logBox.log(`⚠ ${address} - Low balance (${balanceEth} ETH)`);
      table.rows.push([address, balanceEth, 'Skipped', '-', now]);
      spinner.warn(`Skipped (${balanceEth} ETH)`);
      return;
    }

    // Estimate gas with buffer
    const feeData = await provider.getFeeData();
    const gasEstimate = await provider.estimateGas({
      to: targetAddress,
      from: address,
      value: balance - (feeData.maxFeePerGas * 21000n)
    });

    const gasCost = (gasEstimate * (feeData.maxFeePerGas || feeData.gasPrice)) * config.gasBuffer;
    const amount = balance - gasCost;

    if (amount <= 0n) {
      skipped++;
      logBox.log(`⚠ ${address} - Insufficient balance after gas`);
      table.rows.push([address, balanceEth, 'Skipped', '-', now]);
      spinner.warn('Insufficient after gas');
      return;
    }

    // Send transaction
    const tx = await wallet.sendTransaction({
      to: targetAddress,
      value: amount,
      maxFeePerGas: feeData.maxFeePerGas,
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
      gasLimit: gasEstimate
    });

    const receipt = await tx.wait();
    const amountEth = ethers.formatEther(amount);

    if (receipt.status === 1) {
      success++;
      ethFlowData.x.push(index.toString());
      ethFlowData.y.push(Number(amountEth));
      logBox.log(chalk.green(`✔ ${now} | ${amountEth} ETH | ${tx.hash}`));
      table.rows.push([address, amountEth, 'Success', tx.hash.slice(0, 12) + '...', now]);
      spinner.succeed(`Sent ${amountEth} ETH`);
    } else {
      failed++;
      logBox.log(chalk.red(`✖ ${now} | Transaction failed`));
      table.rows.push([address, balanceEth, 'Failed', tx.hash.slice(0, 12) + '...', now]);
      spinner.fail('Transaction failed');
    }
  } catch (err) {
    failed++;
    logBox.log(chalk.red(`✖ ${now} | Error: ${err.message}`));
    table.rows.push([address, '-', 'Failed', '-', now]);
    spinner.fail(err.message);
  } finally {
    updateDashboard();
  }
}

// ====== Main Execution ======
async function main() {
  // Initialize
  if (!loadFiles()) process.exit(1);
  
  provider = new ethers.JsonRpcProvider(config.rpcUrl);
  await provider.ready; // Ensure connection
  
  console.log(chalk.cyan(figlet.textSync('MEGA ETH')));
  console.log(chalk.green(`🚀 Starting consolidation to ${targetAddress}`));
  console.log(`🔗 RPC: ${config.rpcUrl}`);
  console.log(`🔑 Wallets: ${privateKeys.length}\n`);

  // Initialize UI
  initUI();
  
  progressBar = new cliProgress.SingleBar({
    format: '{bar} | {percentage}% | {value}/{total} wallets',
    barCompleteChar: '█',
    barIncompleteChar: '░',
  }, cliProgress.Presets.shades_classic);
  
  progressBar.start(privateKeys.length, 0);

  // Cluster setup
  if (cluster.isPrimary) {
    const clusters = clusterWallets(privateKeys);
    let completed = 0;

    // Fork workers
    for (let i = 0; i < Math.min(config.maxWorkers, clusters.length); i++) {
      cluster.fork();
    }

    cluster.on('message', (worker, { count }) => {
      completed += count;
      progressBar.update(completed);
      
      if (completed >= privateKeys.length) {
        progressBar.stop();
        logBox.log(chalk.green('\n✨ All transactions completed!'));
        setTimeout(gracefulShutdown, 3000);
      }
    });

    cluster.on('exit', (worker) => {
      logBox.log(`Worker ${worker.process.pid} exited`);
    });

  } else {
    // Worker process
    const workerId = cluster.worker.id;
    const clusters = clusterWallets(privateKeys);
    let count = 0;

    try {
      for (let i = workerId - 1; i < clusters.length; i += config.maxWorkers) {
        for (const pk of clusters[i]) {
          await processWallet(pk, ++count);
          process.send?.({ count });
        }
      }
    } catch (err) {
      logBox.log(chalk.red(`Worker ${workerId} error: ${err.message}`));
    }
  }
}

// Error handling
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  gracefulShutdown();
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});

// Start application
main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
