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
  minBalance: '0.002',
  gasBuffer: 1.2,
  maxWorkers: Math.max(1, os.cpus().length - 1),
  refreshInterval: 15000
};

// ====== Initialize ======
let provider;
let privateKeys = [];
let targetAddress = '';
let screen, grid, logBox, statusBox, metricsBox, progressGauge, table;
let success = 0, failed = 0, skipped = 0;
let progressBar;
let walletStats = [];
let isShuttingDown = false;

// ====== Helper Functions ======
function loadFiles() {
  try {
    if (!fs.existsSync('private_keys.txt') || !fs.existsSync('target_address.txt')) {
      throw new Error('Required input files missing');
    }

    privateKeys = fs.readFileSync('private_keys.txt', 'utf-8')
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length === 64 || line.length === 66);
      
    targetAddress = fs.readFileSync('target_address.txt', 'utf-8').trim();
    
    if (privateKeys.length === 0) throw new Error('No valid private keys found');
    if (!ethers.isAddress(targetAddress)) throw new Error('Invalid target address');
    
    return true;
  } catch (err) {
    console.error(chalk.red('Initialization failed:'), err.message);
    return false;
  }
}

function clusterWallets(keys) {
  const clusters = {};
  keys.forEach((key, index) => {
    const prefix = key.slice(2, 6);
    clusters[prefix] = clusters[prefix] || [];
    clusters[prefix].push({ key, index });
  });
  return Object.values(clusters);
}

function initUI() {
  try {
    // Check if we're in a proper terminal environment
    if (!process.stdout.isTTY) {
      console.error(chalk.red('Error: This application requires an interactive terminal'));
      process.exit(1);
    }

    screen = blessed.screen({
      smartCSR: true,
      dockBorders: true,
      fullUnicode: true,
      title: 'MegaETH Consolidator',
      // Add proper terminal handling
      input: process.stdin,
      output: process.stdout,
      terminal: process.env.TERM || 'xterm-256color'
    });

    grid = new contrib.grid({ rows: 12, cols: 12, screen });

    statusBox = grid.set(0, 0, 3, 4, blessed.box, {
      label: ' Status ',
      border: 'line',
      style: { border: { fg: 'cyan' }, fg: 'white' },
      content: 'Initializing...'
    });

    metricsBox = grid.set(0, 4, 3, 4, contrib.gauge, {
      label: ' Processing Metrics ',
      gaugeSpacing: 0,
      gaugeHeight: 1,
      showLabel: true
    });

    progressGauge = grid.set(0, 8, 3, 4, contrib.gauge, {
      label: ' Total Progress ',
      percent: 0,
      stroke: 'green'
    });

    table = grid.set(3, 0, 5, 12, contrib.table, {
      label: ' Transaction Details ',
      columnWidth: [32, 12, 10, 20, 20],
      columnSpacing: 2,
      interactive: true,
      keys: true,
      fg: 'white',
      selectedFg: 'white',
      selectedBg: 'blue',
      columns: ['Address', 'Amount', 'Status', 'Tx Hash', 'Time']
    });

    logBox = grid.set(8, 0, 4, 12, blessed.log, {
      label: ' Transaction Logs ',
      border: 'line',
      style: { fg: 'white', border: { fg: 'cyan' }},
      scrollable: true,
      scrollbar: { bg: 'blue' },
      tags: true
    });

    screen.key(['escape', 'q', 'C-c'], () => {
      if (!isShuttingDown) gracefulShutdown();
    });

    // Handle terminal resize
    screen.on('resize', () => screen.render());

  } catch (err) {
    console.error(chalk.red('UI Initialization failed:'), err.message);
    process.exit(1);
  }
}

function updateDashboard() {
  const total = privateKeys.length;
  const processed = success + failed + skipped;

  statusBox.setContent(
    `{green-fg}Success: ${success}{/green-fg}\n` +
    `{red-fg}Failed: ${failed}{/red-fg}\n` +
    `{yellow-fg}Skipped: ${skipped}{/yellow-fg}\n` +
    `Pending: ${total - processed}`
  );

  metricsBox.setData([
    { percent: (success/total)*100, label: 'Success', 'color': 'green' },
    { percent: (failed/total)*100, label: 'Failed', 'color': 'red' },
    { percent: (skipped/total)*100, label: 'Skipped', 'color': 'yellow' }
  ]);

  progressGauge.setPercent(Math.min(100, (processed/total)*100));
  table.setData({ headers: ['Address', 'Amount', 'Status', 'Tx Hash', 'Time'], data: walletStats });

  if (screen) screen.render();
}

function gracefulShutdown(code = 0) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  try {
    if (cluster.isPrimary && cluster.workers) {
      Object.values(cluster.workers).forEach(worker => {
        if (worker && !worker.isDead()) worker.kill();
      });
    }
    
    if (progressBar) {
      progressBar.stop();
    }
    
    if (screen) {
      // Properly cleanup terminal
      screen.program.clear();
      screen.program.disableMouse();
      screen.program.showCursor();
      screen.program.normalBuffer();
      screen.destroy();
    }
    
    process.stdout.write('\n');
  } catch (err) {
    console.error('Shutdown error:', err);
  } finally {
    process.exit(code);
  }
}

async function processWallet({ key: pk, index }) {
  const wallet = new ethers.Wallet(pk, provider);
  const address = await wallet.getAddress();
  const spinner = ora(`Processing ${address}`).start();
  const now = new Date().toLocaleString();

  try {
    const balance = await provider.getBalance(address);
    const balanceEth = ethers.formatEther(balance);
    const minBalanceWei = ethers.parseEther(config.minBalance);

    if (balance < minBalanceWei) {
      skipped++;
      walletStats.push([address, balanceEth, 'Skipped', '-', now]);
      logBox.log(`{yellow-fg}⚠ ${address} - Low balance (${balanceEth} ETH){/}`);
      spinner.warn(`Skipped (${balanceEth} ETH)`);
      return;
    }

    const feeData = await provider.getFeeData();
    const gasLimit = 21000n;
    const gasCost = (gasLimit * (feeData.maxFeePerGas || feeData.gasPrice)) * BigInt(Math.round(config.gasBuffer * 100)) / 100n;
    const amount = balance - gasCost;

    if (amount <= 0n) {
      skipped++;
      walletStats.push([address, balanceEth, 'Skipped', '-', now]);
      logBox.log(`{yellow-fg}⚠ ${address} - Insufficient after gas{/}`);
      spinner.warn('Insufficient funds');
      return;
    }

    const tx = await wallet.sendTransaction({
      to: targetAddress,
      value: amount,
      gasLimit,
      maxFeePerGas: feeData.maxFeePerGas,
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas
    });

    const receipt = await tx.wait();
    const amountEth = ethers.formatEther(amount);

    if (receipt.status === 1) {
      success++;
      walletStats.push([address, amountEth, 'Success', tx.hash.slice(0, 18), now]);
      logBox.log(`{green-fg}✔ ${now} | ${amountEth} ETH | ${tx.hash}{/}`);
      spinner.succeed(`Sent ${amountEth} ETH`);
    } else {
      throw new Error('Transaction reverted');
    }
  } catch (err) {
    failed++;
    walletStats.push([address, '-', 'Failed', '-', now]);
    logBox.log(`{red-fg}✖ ${now} | Error: ${err.message}{/}`);
    spinner.fail(err.message.slice(0, 50));
  } finally {
    updateDashboard();
  }
}

// ====== Main Execution ======
async function main() {
  if (!loadFiles()) process.exit(1);

  provider = new ethers.JsonRpcProvider(config.rpcUrl);
  await provider.ready;

  console.log(chalk.cyan(figlet.textSync('MEGA ETH')));
  console.log(chalk.green(`🚀 Starting consolidation to ${targetAddress}`));
  console.log(`🔗 RPC: ${config.rpcUrl}`);
  console.log(`🔑 Wallets: ${privateKeys.length}\n`);

  initUI();
  
  progressBar = new cliProgress.SingleBar({
    format: '{bar} | {percentage}% | {value}/{total} wallets',
    barCompleteChar: '█',
    barIncompleteChar: '░',
  }, cliProgress.Presets.shades_classic);
  
  progressBar.start(privateKeys.length, 0);

  if (cluster.isPrimary) {
    const clusters = clusterWallets(privateKeys);
    let completed = 0;

    for (let i = 0; i < Math.min(config.maxWorkers, clusters.length); i++) {
      cluster.fork();
    }

    cluster.on('message', (worker, { count }) => {
      completed += count;
      progressBar.update(completed);
      if (completed >= privateKeys.length) {
        progressBar.stop();
        logBox.log('{green-fg}\n✨ All transactions completed!{/}');
        setTimeout(() => gracefulShutdown(0), 3000);
      }
    });

    cluster.on('exit', (worker) => {
      logBox.log(`Worker ${worker.process.pid} exited`);
    });
  } else {
    const workerId = cluster.worker.id;
    const clusters = clusterWallets(privateKeys);

    try {
      let count = 0;
      for (let i = workerId - 1; i < clusters.length; i += config.maxWorkers) {
        for (const wallet of clusters[i]) {
          await processWallet(wallet);
          count++;
          process.send?.({ count: 1 });
        }
      }
    } catch (err) {
      logBox.log(`{red-fg}Worker ${workerId} error: ${err.message}{/}`);
    }
  }
}

// Enhanced error handling
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  if (!isShuttingDown) gracefulShutdown(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});

process.on('SIGTERM', () => gracefulShutdown(0));
process.on('SIGINT', () => gracefulShutdown(0));

main().catch(err => {
  console.error('Fatal error:', err);
  gracefulShutdown(1);
});
