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

class ETHConsolidator:
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
        
        # Initialize Web3 connection
        self.w3 = self._connect_to_provider()
        
        # Load addresses
        with open('target_address.txt', 'r') as f:
            self.target_address = f.read().strip()
        
        if not self.w3.is_address(self.target_address):
            raise ValueError("Invalid target address")
        
        # Load wallets (supports large files)
        self.private_keys = []
        with open('private_keys.txt', 'r') as f:
            for line in f:
                line = line.strip()
                if line:
                    self.private_keys.append(line)

    def _connect_to_provider(self):
        """Connect to RPC with retries"""
        for endpoint in self.rpc_endpoints:
            try:
                w3 = Web3(Web3.HTTPProvider(endpoint))
                if w3.is_connected():
                    print(f"{Fore.GREEN}✓ Connected to {endpoint}{Style.RESET_ALL}")
                    return w3
            except Exception as e:
                print(f"{Fore.YELLOW}⚠ Connection failed to {endpoint}: {e}{Style.RESET_ALL}")
        raise ConnectionError(f"{Fore.RED}✗ Could not connect to any RPC endpoint{Style.RESET_ALL}")

    def _print_status(self, message, status="info"):
        """Colorful status messages"""
        colors = {
            "info": Fore.BLUE,
            "success": Fore.GREEN,
            "warning": Fore.YELLOW,
            "error": Fore.RED,
            "header": Fore.MAGENTA + Style.BRIGHT
        }
        print(f"{colors.get(status, '')}{message}{Style.RESET_ALL}")

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
                self._print_status(f"{address} - Zero balance", "warning")
                return None
            
            # Calculate transfer amount (leave 0.001 ETH for gas)
            amount_to_send = max(balance - 0.001, 0)
            if amount_to_send <= 0:
                self._print_status(f"{address} - Insufficient balance", "warning")
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
                    
                    # Wait for confirmation
                    receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)
                    
                    # Log transaction
                    with open('transactions.csv', 'a', newline='') as f:
                        writer = csv.writer(f)
                        writer.writerow([
                            address,
                            balance,
                            amount_to_send,
                            tx_hash.hex()
                        ])
                    
                    self._print_status(
                        f"{address} - Sent {amount_to_send:.6f} ETH | TX: {tx_hash.hex()}",
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
            self._print_status(f"{address} - Error: {str(e)}", "error")
            return None

    def run(self):
        """Main execution with parallel processing"""
        # Print header
        self._print_status("\n" + "="*50, "header")
        self._print_status("MEGA ETH Consolidation Bot", "header")
        self._print_status(f"Target: {self.target_address}", "header")
        self._print_status(f"Wallets: {len(self.private_keys)}", "header")
        self._print_status("="*50 + "\n", "header")
        
        # Initialize CSV
        with open('transactions.csv', 'w', newline='') as f:
            writer = csv.writer(f)
            writer.writerow(['Address', 'Balance', 'Amount Sent', 'TxHash'])
        
        # Process wallets in parallel
        start_time = time.time()
        successful = 0
        
        with ThreadPoolExecutor(max_workers=5) as executor:
            results = executor.map(self.transfer_eth, self.private_keys)
            successful = sum(1 for result in results if result is not None)
        
        # Print summary
        elapsed = time.time() - start_time
        self._print_status("\n" + "="*50, "header")
        self._print_status("CONSOLIDATION COMPLETE", "header")
        self._print_status(f"Success: {successful}", "success")
        self._print_status(f"Failed: {len(self.private_keys) - successful}", "error" if successful != len(self.private_keys) else "success")
        self._print_status(f"Time: {elapsed:.2f} seconds", "info")
        self._print_status("="*50, "header")

if __name__ == "__main__":
    try:
        consolidator = ETHConsolidator()
        consolidator.run()
    except Exception as e:
        print(f"{Fore.RED}✗ Fatal error: {str(e)}{Style.RESET_ALL}")
