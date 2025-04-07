import { ethers } from 'ethers';
import fs from 'fs';
import chalk from 'chalk';
import blessed from 'blessed';
import contrib from 'blessed-contrib';

// ===== Configuration =====
const CONFIG = {
  rpcUrl: 'https://carrot.megaeth.com/rpc',
  chainId: 6342,
  minBalance: '0.002', // Minimum ETH balance to process
  gasBuffer: 1.2, // 20% gas buffer
  refreshInterval: 2000 // Dashboard refresh rate
};

// ===== Dashboard Setup =====
const screen = blessed.screen({
  smartCSR: true,
  title: 'MEGA ETH Consolidator'
});

const grid = new contrib.grid({ rows: 12, cols: 12, screen });

// Status Donut Chart
const donut = grid.set(0, 0, 4, 4, contrib.donut, {
  label: ' Status ',
  radius: 8,
  arcWidth: 4,
  data: [
    { label: 'Success', percent: 0, color: 'green' },
    { label: 'Failed', percent: 0, color: 'red' },
    { label: 'Skipped', percent: 0, color: 'yellow' }
  ]
});

// Process Logs
const logBox = grid.set(4, 0, 6, 12, blessed.log, {
  label: ' Process Logs ',
  border: { type: 'line' },
  style: {
    fg: 'white',
    border: { fg: 'cyan' }
  },
  scrollable: true,
  scrollbar: {
    ch: ' ',
    inverse: true
  },
  keys: true,
  vi: true
});

// Transaction Details Table
const table = grid.set(10, 0, 2, 12, contrib.table, {
  label: ' Transaction Details ',
  columnWidth: [20, 12, 10, 24, 16],
  columnSpacing: 2,
  interactive: true
});

// Key Bindings Help
const helpBar = blessed.box({
  parent: screen,
  bottom: 0,
  left: 0,
  width: '100%',
  height: 1,
  content: chalk.cyan('Q/ESC: Exit | ↑/↓: Scroll Logs | TAB: Switch Focus'),
  style: {
    bg: 'blue'
  }
});

// ===== State Management =====
let provider;
let privateKeys = [];
let targetAddress = '';
const stats = {
  success: 0,
  failed: 0,
  skipped: 0,
  totalETH: 0
};

// ===== Core Functions =====
function initialize() {
  try {
    // Load and validate files
    if (!fs.existsSync('private_keys.txt') || !fs.existsSync('target_address.txt')) {
      logBox.log(chalk.red('❌ Missing required files'));
      return false;
    }

    privateKeys = fs.readFileSync('private_keys.txt', 'utf-8')
      .split('\n')
      .map(line => line.trim())
      .filter(line => /^(0x)?[0-9a-f]{64}$/i.test(line));

    targetAddress = fs.readFileSync('target_address.txt', 'utf-8').trim();

    if (!privateKeys.length || !ethers.isAddress(targetAddress)) {
      logBox.log(chalk.red('❌ Invalid wallet data'));
      return false;
    }

    logBox.log(chalk.green(`✓ Loaded ${privateKeys.length} valid private keys`));
    return true;
  } catch (err) {
    logBox.log(chalk.red(`❌ Initialization error: ${err.message}`));
    return false;
  }
}

async function processWallet(pk, index) {
  const wallet = new ethers.Wallet(pk, provider);
  const address = wallet.address;

  try {
    const balance = await provider.getBalance(address);
    const balanceEth = ethers.formatEther(balance);
    const minBalanceWei = ethers.parseEther(CONFIG.minBalance);

    if (balance < minBalanceWei) {
      stats.skipped++;
      logBox.log(chalk.yellow(`⚠ ${address.slice(0, 8)}... - Low balance (${balanceEth} ETH)`));
      updateTable(address, balanceEth, 'Skipped');
      return;
    }

    const feeData = await provider.getFeeData();
    const gasEstimate = 21000n;
    const gasCost = (gasEstimate * feeData.maxFeePerGas * CONFIG.gasBuffer * 100n) / 100n;
    const amount = balance - gasCost;

    if (amount <= 0n) {
      stats.skipped++;
      logBox.log(chalk.yellow(`⚠ ${address.slice(0, 8)}... - Insufficient after gas`));
      updateTable(address, balanceEth, 'Skipped');
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
    const amountEth = ethers.formatEther(amount);

    if (receipt.status === 1) {
      stats.success++;
      stats.totalETH += parseFloat(amountEth);
      logBox.log(chalk.green(`✓ ${address.slice(0, 8)}... - Sent ${amountEth} ETH`));
      updateTable(address, amountEth, 'Success', tx.hash);
    } else {
      throw new Error('Transaction reverted');
    }
  } catch (err) {
    stats.failed++;
    logBox.log(chalk.red(`✗ ${address.slice(0, 8)}... - ${err.message.split('\n')[0]}`));
    updateTable(address, '-', 'Failed');
  } finally {
    updateDashboard();
  }
}

function updateTable(address, amount, status, txHash = '-') {
  const now = new Date().toLocaleTimeString();
  const currentData = table.getData();
  const newRow = [
    address.slice(0, 6) + '...' + address.slice(-4),
    amount,
    status,
    txHash === '-' ? '-' : txHash.slice(0, 8) + '...',
    now
  ];

  table.setData({
    headers: ['Address', 'Amount', 'Status', 'Tx Hash', 'Time'],
    data: [...(currentData.data || []), newRow]
  });
}

function updateDashboard() {
  const total = stats.success + stats.failed + stats.skipped;
  donut.setData([
    { label: 'Success', percent: total ? (stats.success / total) * 100 : 0, color: 'green' },
    { label: 'Failed', percent: total ? (stats.failed / total) * 100 : 0, color: 'red' },
    { label: 'Skipped', percent: total ? (stats.skipped / total) * 100 : 0, color: 'yellow' }
  ]);
  screen.render();
}

function gracefulShutdown() {
  screen.destroy();
  process.exit(0);
}

// ===== Main Execution =====
async function main() {
  // UI Event Handlers
  screen.key(['q', 'escape', 'C-c'], gracefulShutdown);
  screen.key(['up', 'down'], (ch, key) => {
    if (key.name === 'up') logBox.scroll(-1);
    if (key.name === 'down') logBox.scroll(1);
    screen.render();
  });

  // Initialization
  if (!initialize()) {
    setTimeout(gracefulShutdown, 3000);
    return;
  }

  try {
    provider = new ethers.JsonRpcProvider(CONFIG.rpcUrl);
    await provider.ready;
    logBox.log(chalk.green(`✓ Connected to ${CONFIG.rpcUrl}`));
  } catch (err) {
    logBox.log(chalk.red(`❌ RPC connection failed: ${err.message}`));
    setTimeout(gracefulShutdown, 3000);
    return;
  }

  // Process wallets
  for (let i = 0; i < privateKeys.length; i++) {
    await processWallet(privateKeys[i], i);
  }

  // Final status
  logBox.log(chalk.green.bold('\n✨ All transactions completed!'));
  logBox.log(chalk.cyan(`💰 Total ETH Sent: ${stats.totalETH.toFixed(6)}`));
  logBox.log(chalk.cyan('Press Q or ESC to exit'));
}

// Start
main().catch(err => {
  logBox.log(chalk.red(`⚠ Fatal error: ${err.message}`));
  setTimeout(gracefulShutdown, 3000);
});
