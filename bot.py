import os
import time
import csv
from concurrent.futures import ThreadPoolExecutor
from web3 import Web3
from dotenv import load_dotenv
from rich.console import Console
from rich.table import Table
from rich.progress import track
from rich.panel import Panel
from rich.text import Text
from rich import box

# Load environment variables
load_dotenv()

console = Console()

class MegaEthSender:
    def __init__(self, ui_callback):
        self.ui_callback = ui_callback
        self.rpc_endpoints = ['https://carrot.megaeth.com/rpc']
        self.chain_id = 6342
        self.max_fee_per_gas = Web3.to_wei(0.0025, 'gwei')
        self.max_priority_fee_per_gas = Web3.to_wei(0.001, 'gwei')
        self.w3 = self._connect_to_provider()
        self.target_address = self._load_target_address()
        self.private_keys = self._load_private_keys()

    def _connect_to_provider(self):
        for endpoint in self.rpc_endpoints:
            try:
                w3 = Web3(Web3.HTTPProvider(endpoint))
                if w3.is_connected():
                    self.ui_callback(f"Connected to {endpoint}", "success")
                    return w3
            except Exception as e:
                self.ui_callback(f"Connection failed to {endpoint}: {str(e)}", "warning")
        raise ConnectionError("Could not connect to any RPC endpoint")

    def _load_target_address(self):
        with open('target_address.txt', 'r') as f:
            address = f.read().strip()
        if not Web3.is_address(address):
            raise ValueError("Invalid target address")
        return address

    def _load_private_keys(self):
        with open('private_keys.txt', 'r') as f:
            keys = [line.strip() for line in f if line.strip()]
        if not keys:
            raise ValueError("No private keys found")
        return keys

    def transfer_eth(self, private_key):
        account = self.w3.eth.account.from_key(private_key)
        address = account.address

        try:
            balance_wei = self.w3.eth.get_balance(address)
            balance_eth = float(Web3.from_wei(balance_wei, 'ether'))

            if balance_eth <= 0:
                self.ui_callback(f"{address[:8]}...{address[-6:]} - Zero balance", "warning")
                return None

            gas_cost = float(Web3.from_wei(21000 * self.max_fee_per_gas, 'ether'))
            amount_to_send = max(balance_eth - gas_cost, 0)

            if amount_to_send <= 0:
                self.ui_callback(f"{address[:8]}...{address[-6:]} - Insufficient balance (needs {gas_cost:.6f} ETH)", "warning")
                return None

            tx = {
                'nonce': self.w3.eth.get_transaction_count(address),
                'to': self.target_address,
                'value': Web3.to_wei(amount_to_send, 'ether'),
                'gas': 21000,
                'maxFeePerGas': self.max_fee_per_gas,
                'maxPriorityFeePerGas': self.max_priority_fee_per_gas,
                'chainId': self.chain_id,
                'type': '0x2'
            }

            signed_tx = self.w3.eth.account.sign_transaction(tx, private_key)
            tx_hash = self.w3.eth.send_raw_transaction(signed_tx.rawTransaction)
            receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)

            with open('transactions.csv', 'a', newline='') as f:
                writer = csv.writer(f)
                writer.writerow([address, balance_eth, amount_to_send, tx_hash.hex()])

            self.ui_callback(f"{address[:8]}...{address[-6:]} - Sent {amount_to_send:.6f} ETH", "success")
            return tx_hash.hex()

        except Exception as e:
            with open('errors.log', 'a') as f:
                f.write(f"{address},{str(e)}\n")
            self.ui_callback(f"{address[:8]}...{address[-6:]} - Error: {str(e)}", "error")
            return None


class MegaEthSenderUI:
    def __init__(self):
        self.sender = MegaEthSender(self.update_console)
        self.total_wallets = len(self.sender.private_keys)
        self.successful = 0
        self.failed = 0
        self.logs = []

    def update_console(self, message, msg_type="info"):
        timestamp = time.strftime("%H:%M:%S")
        formatted = f"{timestamp} | [{msg_type.upper()}] {message}"
        self.logs.append((formatted, msg_type))
        self.render_ui()

    def render_ui(self):
        os.system('cls' if os.name == 'nt' else 'clear')

        # Header
        console.print(Panel(Text("MEGA ETH SENDER PRO", style="bold cyan"), subtitle="Version 1.0", style="bold magenta"))

        # Wallet Info
        info = Table(title="Target Wallet Info", show_header=False, box=box.SIMPLE)
        info.add_column("Key", style="bold")
        info.add_column("Value")
        info.add_row("Address", f"{self.sender.target_address[:8]}...{self.sender.target_address[-6:]}")
        info.add_row("Network", "MEGA Testnet")
        info.add_row("Chain ID", str(self.sender.chain_id))
        console.print(info)

        # Logs
        log_table = Table(title="Logs (Latest 10)", show_header=False, box=box.SIMPLE)
        log_table.add_column("Message")
        for msg, level in self.logs[-10:]:
            log_color = {"success": "green", "warning": "yellow", "error": "red", "info": "cyan"}.get(level, "white")
            log_table.add_row(Text(msg, style=log_color))
        console.print(log_table)

        # Footer Controls
        console.print(Panel("Controls: [bold green]Run[/] | [bold yellow]Clear Logs[/] | [bold cyan]Exit[/]", style="blue"))

    def run(self):
        self.update_console("=== Starting MEGA ETH Sender ===", "info")
        self.update_console(f"Target Address: {self.sender.target_address}", "info")
        self.update_console(f"Total Wallets: {self.total_wallets}", "info")

        with open('transactions.csv', 'w', newline='') as f:
            writer = csv.writer(f)
            writer.writerow(['Address', 'Balance', 'Amount Sent', 'TxHash'])

        with ThreadPoolExecutor(max_workers=5) as executor:
            results = list(track(executor.map(self.sender.transfer_eth, self.sender.private_keys),
                                 total=self.total_wallets, description="Processing Wallets..."))

        self.successful = sum(1 for r in results if r)
        self.failed = self.total_wallets - self.successful

        self.update_console("=== Transaction Summary ===", "info")
        self.update_console(f"Total: {self.total_wallets}", "info")
        self.update_console(f"Success: {self.successful}", "success")
        self.update_console(f"Failed: {self.failed}", "error" if self.failed else "success")


if __name__ == "__main__":
    app = MegaEthSenderUI()
    app.run()
