import os
import time
import csv
from concurrent.futures import ThreadPoolExecutor
from web3 import Web3
from web3.exceptions import TransactionNotFound
from dotenv import load_dotenv
from colorama import init, Fore, Back, Style

# Initialize colorama
init(autoreset=True)
load_dotenv()

class MegaEthSender:
    def __init__(self):
        # MEGA Testnet configuration
        self.rpc_endpoints = [
            'https://carrot.megaeth.com/rpc',
            'https://rpc.testnet.megaeth.com',
            'https://testnet.megaeth.io/rpc'
        ]
        self.chain_id = 6342
        self.max_fee_per_gas = Web3.to_wei(0.0025, 'gwei')
        self.max_priority_fee_per_gas = Web3.to_wei(0.001, 'gwei')
        
        # UI Configuration
        self.ui_width = 60
        self.colors = {
            "success": Fore.GREEN + Style.BRIGHT,
            "error": Fore.RED + Style.BRIGHT,
            "warning": Fore.YELLOW + Style.BRIGHT,
            "info": Fore.CYAN,
            "header": Fore.MAGENTA + Style.BRIGHT,
            "highlight": Fore.WHITE + Style.BRIGHT + Back.BLUE
        }
        
        # Initialize connection
        self.w3 = self._connect_to_provider()
        
        # Load addresses
        self.target_address = self._load_target_address()
        self.private_keys = self._load_private_keys()

    def _connect_to_provider(self):
        """Connect to RPC with retries"""
        self._print_ui_box("Connecting to MEGA Testnet")
        for endpoint in self.rpc_endpoints:
            try:
                w3 = Web3(Web3.HTTPProvider(endpoint))
                if w3.is_connected():
                    self._print_status(f"✓ Connected to {endpoint}", "success")
                    return w3
            except Exception as e:
                self._print_status(f"⚠ Connection failed to {endpoint}", "warning")
        raise ConnectionError(self._format_message("✗ Could not connect to any RPC endpoint", "error"))

    def _load_target_address(self):
        """Load and validate target address"""
        with open('target_address.txt', 'r') as f:
            address = f.read().strip()
        if not self.w3.is_address(address):
            raise ValueError(self._format_message("Invalid target address", "error"))
        return address

    def _load_private_keys(self):
        """Load private keys from file"""
        keys = []
        with open('private_keys.txt', 'r') as f:
            for line in f:
                line = line.strip()
                if line:
                    keys.append(line)
        if not keys:
            raise ValueError(self._format_message("No private keys found", "error"))
        return keys

    def _format_message(self, message, msg_type="info"):
        """Format colored message"""
        return f"{self.colors.get(msg_type, '')}{message}{Style.RESET_ALL}"

    def _print_status(self, message, msg_type="info"):
        """Print status message with colored prefix"""
        symbols = {
            "success": "✓",
            "error": "✗",
            "warning": "⚠",
            "info": "•"
        }
        print(f"{self.colors.get(msg_type, '')}{symbols.get(msg_type, '')} {message}{Style.RESET_ALL}")

    def _print_ui_box(self, title):
        """Print boxed UI element"""
        print(f"\n{self.colors['header']}{'=' * self.ui_width}")
        print(f"{title.center(self.ui_width)}")
        print(f"{'=' * self.ui_width}{Style.RESET_ALL}\n")

    def get_balance(self, address):
        """Get balance with retries"""
        for attempt in range(3):
            try:
                balance_wei = self.w3.eth.get_balance(address)
                return float(self.w3.from_wei(balance_wei, 'ether'))
            except Exception as e:
                if attempt == 2:
                    raise
                time.sleep(2 ** attempt)
                self.w3 = self._connect_to_provider()

    def transfer_eth(self, private_key):
        """Process single wallet transfer"""
        account = self.w3.eth.account.from_key(private_key)
        address = account.address
        
        try:
            # Get balance
            balance = self.get_balance(address)
            if balance <= 0:
                self._print_status(f"{address[:8]}...{address[-6:]} - Zero balance", "warning")
                return None
            
            # Calculate transfer amount (dynamic gas calculation)
            gas_cost = self.w3.from_wei(21000 * self.max_fee_per_gas, 'ether')
            amount_to_send = max(balance - gas_cost, 0)
            
            if amount_to_send <= 0:
                self._print_status(f"{address[:8]}...{address[-6:]} - Insufficient balance (needs {gas_cost:.6f} ETH for gas)", "warning")
                return None
            
            # Prepare transaction
            tx = {
                'nonce': self.w3.eth.get_transaction_count(address),
                'to': self.target_address,
                'value': self.w3.to_wei(amount_to_send, 'ether'),
                'gas': 21000,
                'maxFeePerGas': self.max_fee_per_gas,
                'maxPriorityFeePerGas': self.max_priority_fee_per_gas,
                'chainId': self.chain_id,
                'type': '0x2'
            }
            
            # Send transaction with retries
            for attempt in range(3):
                try:
                    signed_tx = self.w3.eth.account.sign_transaction(tx, private_key)
                    tx_hash = self.w3.eth.send_raw_transaction(signed_tx.rawTransaction)
                    receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)
                    
                    # Log transaction
                    with open('transactions.csv', 'a', newline='') as f:
                        writer = csv.writer(f)
                        writer.writerow([address, balance, amount_to_send, tx_hash.hex()])
                    
                    self._print_status(
                        f"{address[:8]}...{address[-6:]} - Sent {amount_to_send:.6f} ETH | TX: {tx_hash.hex()}",
                        "success"
                    )
                    return tx_hash.hex()
                
                except Exception as e:
                    if attempt == 2:
                        raise
                    time.sleep(2 ** attempt)
        
        except Exception as e:
            with open('errors.log', 'a') as f:
                f.write(f"{address},{str(e)}\n")
            self._print_status(f"{address[:8]}...{address[-6:]} - Error: {str(e)}", "error")
            return None

    def run(self):
        """Main execution with parallel processing"""
        # Print header
        self._print_ui_box("MEGA ETH SENDER")
        print(f"{self.colors['header']}• Target:{Style.RESET_ALL} {self.target_address}")
        print(f"{self.colors['header']}• Wallets:{Style.RESET_ALL} {len(self.private_keys)}")
        print(f"{self.colors['header']}• Network:{Style.RESET_ALL} MEGA Testnet (Chain ID: {self.chain_id})")
        
        # Initialize CSV
        with open('transactions.csv', 'w', newline='') as f:
            writer = csv.writer(f)
            writer.writerow(['Address', 'Balance', 'Amount Sent', 'TxHash'])
        
        # Process wallets
        start_time = time.time()
        successful = 0
        
        with ThreadPoolExecutor(max_workers=5) as executor:
            results = executor.map(self.transfer_eth, self.private_keys)
            successful = sum(1 for result in results if result is not None)
        
        # Print summary
        elapsed = time.time() - start_time
        self._print_ui_box("TRANSACTION SUMMARY")
        print(f"{self.colors['success']}✓ Successful:{Style.RESET_ALL} {successful}")
        print(f"{self.colors['error'] if successful != len(self.private_keys) else self.colors['success']}✗ Failed:{Style.RESET_ALL} {len(self.private_keys) - successful}")
        print(f"{self.colors['info']}⏱ Time:{Style.RESET_ALL} {elapsed:.2f} seconds")
        
        if successful > 0:
            print(f"\n{self.colors['highlight']} Transactions saved to: transactions.csv {Style.RESET_ALL}")
        if successful != len(self.private_keys):
            print(f"\n{self.colors['highlight']} Errors logged to: errors.log {Style.RESET_ALL}")

if __name__ == "__main__":
    try:
        sender = MegaEthSender()
        sender.run()
    except Exception as e:
        print(f"\n{Fore.RED + Style.BRIGHT}✗ Fatal error: {str(e)}{Style.RESET_ALL}")
