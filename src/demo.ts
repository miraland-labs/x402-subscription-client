import 'dotenv/config';
import { Keypair } from '@solana/web3.js';
import { X402SubscriptionClient } from './client.js';
import * as fs from 'fs';

const keypairPath = process.env.BUYER_KEYPAIR_PATH || '../demo-wallets/buyer-keypair.json';
const endpointBaseUrl = process.env.API_BASE_URL || 'http://127.0.0.1:3000';
const tokenFile = process.env.SUBSCRIPTION_TOKEN_FILE || './subscription-token.json';

async function main() {
  const secretKey = Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, 'utf8')));
  const payer = Keypair.fromSecretKey(secretKey);

  const saved = X402SubscriptionClient.loadSubscriptionFromFile(tokenFile);
  const client = new X402SubscriptionClient({
    payerKeypair: payer,
    endpointBaseUrl: saved?.endpointBaseUrl ?? endpointBaseUrl,
    savedSubscription: saved ?? undefined,
    logger: (m) => console.log(m),
  });

  if (!client.getActiveSubscription()) {
    console.log('Purchasing hourly subscription...');
    await client.subscribe('hourly');
    client.saveSubscriptionToFile(tokenFile);
  } else {
    console.log('Reusing saved subscription token.');
  }

  const res = await client.echo({ demo: true });
  console.log('Echo response:', res);
}

main().catch(console.error);
