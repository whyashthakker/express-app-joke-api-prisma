#!/usr/bin/env python3
"""
Price Lottery Bot - Auto-win the price lottery game!

Game Rules:
1. GET /prices until you get price = 1
2. Solve the math challenge within 60 seconds
3. POST /prices/solve with the answer
4. Win and get announced on Discord!

Rate Limit: Max 1 RPS (or get silenced for 10 seconds)
"""

import requests
import time
import re
import json
from datetime import datetime

class PriceLotteryBot:
    def __init__(self, base_url="http://localhost:8080", winner_name="PythonBot"):
        self.base_url = base_url
        self.winner_name = winner_name
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'PriceLotteryBot/1.0 (Python Winner Script)',
            'Content-Type': 'application/json'
        })
        
    def log(self, message):
        """Log with timestamp"""
        timestamp = datetime.now().strftime("%H:%M:%S")
        print(f"[{timestamp}] {message}")
        
    def solve_math_problem(self, question):
        """Solve simple math problems like '125 + 387'"""
        try:
            # Extract numbers and operation
            match = re.match(r'What is (\d+) ([\+\-\*]) (\d+)\?', question)
            if not match:
                self.log(f"❌ Can't parse question: {question}")
                return None
                
            num1, operation, num2 = match.groups()
            num1, num2 = int(num1), int(num2)
            
            if operation == '+':
                result = num1 + num2
            elif operation == '-':
                result = num1 - num2
            elif operation == '*':
                result = num1 * num2
            else:
                self.log(f"❌ Unknown operation: {operation}")
                return None
                
            self.log(f"🧮 Math: {num1} {operation} {num2} = {result}")
            return result
            
        except Exception as e:
            self.log(f"❌ Math error: {e}")
            return None
    
    def get_price(self):
        """Get random price from lottery endpoint"""
        try:
            response = self.session.get(f"{self.base_url}/prices")
            
            if response.status_code == 429:
                # Rate limited
                data = response.json()
                time_remaining = data.get('timeRemaining', '10 seconds')
                self.log(f"⏸️  Rate limited! Waiting {time_remaining}")
                
                # Extract seconds from "X seconds" string
                seconds = re.findall(r'(\d+)', time_remaining)
                if seconds:
                    wait_time = int(seconds[0]) + 1  # Add 1 second buffer
                    time.sleep(wait_time)
                else:
                    time.sleep(11)  # Default 11 seconds
                return None
                
            elif response.status_code != 200:
                self.log(f"❌ Error: {response.status_code} - {response.text}")
                return None
                
            data = response.json()
            price = data.get('price')
            is_winner = data.get('lottery', {}).get('isWinner', False)
            
            if is_winner:
                challenge = data.get('challenge', {})
                self.log(f"🎰 JACKPOT! Got price {price}!")
                self.log(f"🎯 Challenge: {challenge.get('question')}")
                self.log(f"⏰ Time limit: {challenge.get('timeLimit')}")
                return challenge
            else:
                self.log(f"🎲 Price: {price} (need 1 for jackpot)")
                return False
                
        except Exception as e:
            self.log(f"❌ Request error: {e}")
            return None
    
    def solve_challenge(self, challenge):
        """Solve the math challenge"""
        try:
            challenge_id = challenge.get('challengeId')
            question = challenge.get('question')
            
            if not challenge_id or not question:
                self.log("❌ Invalid challenge data")
                return False
            
            # Solve the math problem
            answer = self.solve_math_problem(question)
            if answer is None:
                return False
            
            # Submit answer
            payload = {
                'challengeId': challenge_id,
                'answer': answer,
                'winner': self.winner_name
            }
            
            self.log(f"🚀 Submitting answer: {answer}")
            response = self.session.post(f"{self.base_url}/prices/solve", json=payload)
            
            if response.status_code == 200:
                data = response.json()
                if data.get('success'):
                    self.log(f"🎉 WON! {data.get('message')}")
                    self.log(f"⚡ Solve time: {data.get('challenge', {}).get('solveTime')}")
                    self.log(f"🎊 Achievement: {data.get('achievement')}")
                    return True
                else:
                    self.log(f"❌ Unexpected response: {data}")
                    
            else:
                error_data = response.json() if response.headers.get('content-type') == 'application/json' else {}
                error_msg = error_data.get('error', response.text)
                self.log(f"❌ Submit failed: {error_msg}")
                
                if 'Incorrect answer' in error_msg:
                    self.log(f"💭 My answer: {answer}")
                    self.log(f"❓ Question was: {question}")
                
            return False
            
        except Exception as e:
            self.log(f"❌ Challenge error: {e}")
            return False
    
    def run(self, max_attempts=1000):
        """Run the bot to win the lottery"""
        self.log(f"🤖 Starting Price Lottery Bot!")
        self.log(f"🎯 Target: {self.base_url}/prices")
        self.log(f"👤 Winner name: {self.winner_name}")
        self.log(f"📊 Max attempts: {max_attempts}")
        self.log(f"⚡ Rate limit: 1 RPS")
        self.log("=" * 50)
        
        attempt = 0
        start_time = time.time()
        
        while attempt < max_attempts:
            attempt += 1
            
            # Get price (respects 1 RPS limit automatically via rate limiting)
            result = self.get_price()
            
            if result is None:
                # Rate limited or error, continue
                continue
            elif result is False:
                # Didn't get price = 1, wait and try again
                time.sleep(1.1)  # 1.1 second to be safe with rate limiting
                continue
            else:
                # Got challenge! Try to solve it
                if self.solve_challenge(result):
                    elapsed = time.time() - start_time
                    self.log(f"🏆 VICTORY! Won in {attempt} attempts ({elapsed:.1f}s)")
                    self.log(f"🎉 Check Discord for winner announcement!")
                    return True
                else:
                    self.log(f"😞 Failed to solve challenge, continuing...")
                    time.sleep(1.1)
        
        self.log(f"😴 Reached max attempts ({max_attempts})")
        return False

if __name__ == "__main__":
    # You can customize these
    BASE_URL = "http://localhost:8080"
    WINNER_NAME = "PythonMaster"
    MAX_ATTEMPTS = 500
    
    bot = PriceLotteryBot(BASE_URL, WINNER_NAME)
    
    try:
        bot.run(MAX_ATTEMPTS)
    except KeyboardInterrupt:
        bot.log("🛑 Stopped by user")
    except Exception as e:
        bot.log(f"💥 Unexpected error: {e}")