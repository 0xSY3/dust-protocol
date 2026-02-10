import { ethers } from 'ethers';
import { ec as EC } from 'elliptic';
import { NextResponse } from 'next/server';

const RPC_URL = 'https://rpc.thanos-sepolia.tokamak.network';
const CHAIN_ID = 111551119090;
const SPONSOR_KEY = process.env.RELAYER_PRIVATE_KEY;

const ANNOUNCER_ADDRESS = '0x2C2a59E9e71F2D1A8A2D447E73813B9F89CBb125';
const NAME_REGISTRY_ADDRESS = process.env.NEXT_PUBLIC_STEALTH_NAME_REGISTRY_ADDRESS || '0x0129DE641192920AB78eBca2eF4591E2Ac48BA59';
const STEALTH_WALLET_FACTORY = '0x85e7Fe33F594AC819213e63EEEc928Cb53A166Cd';
const STEALTH_WALLET_CREATION_CODE = '0x60a060405234801561000f575f80fd5b506040516107e03803806107e083398101604081905261002e9161003f565b6001600160a01b031660805261006c565b5f6020828403121561004f575f80fd5b81516001600160a01b0381168114610065575f80fd5b9392505050565b60805161074f6100915f395f8181607e015281816101a90152610365015261074f5ff3fe608060405260043610610041575f3560e01c80635cd5972c1461004c5780638da5cb5b1461006d578063affed0e0146100bd578063da0980c7146100df575f80fd5b3661004857005b5f80fd5b348015610057575f80fd5b5061006b610066366004610599565b6100fe565b005b348015610078575f80fd5b506100a07f000000000000000000000000000000000000000000000000000000000000000081565b6040516001600160a01b0390911681526020015b60405180910390f35b3480156100c8575f80fd5b506100d15f5481565b6040519081526020016100b4565b3480156100ea575f80fd5b5061006b6100f93660046105e8565b61028f565b5f80546040516bffffffffffffffffffffffff1930606090811b8216602084015287901b16603482015260488101919091524660688201526088016040516020818303038152906040528051906020012090505f8160405160200161018f91907f19457468657265756d205369676e6564204d6573736167653a0a3332000000008152601c810191909152603c0190565b6040516020818303038152906040528051906020012090507f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03166101dc828686610459565b6001600160a01b031614610202576040516282b42960e81b815260040160405180910390fd5b5f8054908061021083610680565b909155505060405147905f906001600160a01b0388169083908381818185875af1925050503d805f811461025f576040519150601f19603f3d011682016040523d82523d5f602084013e610264565b606091505b5050905080610286576040516312171d8360e31b815260040160405180910390fd5b50505050505050565b5f30878787876040516102a3929190610698565b6040519081900381205f546bffffffffffffffffffffffff19606096871b811660208501529490951b90931660348201526048810191909152606881019190915260888101919091524660a882015260c8016040516020818303038152906040528051906020012090505f8160405160200161034b91907f19457468657265756d205369676e6564204d6573736167653a0a3332000000008152601c810191909152603c0190565b6040516020818303038152906040528051906020012090507f00000000000000000000000000000000000000000000000000000000000000006001600160a01b0316610398828686610459565b6001600160a01b0316146103be576040516282b42960e81b815260040160405180910390fd5b5f805490806103cc83610680565b91905055505f886001600160a01b03168888886040516103ed929190610698565b5f6040518083038185875af1925050503d805f8114610427576040519150601f19603f3d011682016040523d82523d5f602084013e61042c565b606091505b505090508061044e576040516312171d8360e31b815260040160405180910390fd5b505050505050505050565b5f6041821461046957505f610532565b5f61047760208285876106a7565b610480916106ce565b90505f6104916040602086886106a7565b61049a916106ce565b90505f858560408181106104b0576104b06106ec565b919091013560f81c915050601b8110156104d2576104cf601b82610700565b90505b604080515f81526020810180835289905260ff831691810191909152606081018490526080810183905260019060a0016020604051602081039080840390855afa158015610522573d5f803e3d5ffd5b5050506020604051035193505050505b9392505050565b80356001600160a01b038116811461054f575f80fd5b919050565b5f8083601f840112610564575f80fd5b50813567ffffffffffffffff81111561057b575f80fd5b602083019150836020828501011115610592575f80fd5b9250929050565b5f805f604084860312156105ab575f80fd5b6105b484610539565b9250602084013567ffffffffffffffff8111156105cf575f80fd5b6105db86828701610554565b9497909650939450505050565b5f805f805f80608087890312156105fd575f80fd5b61060687610539565b955060208701359450604087013567ffffffffffffffff80821115610629575f80fd5b6106358a838b01610554565b9096509450606089013591508082111561064d575f80fd5b5061065a89828a01610554565b979a9699509497509295939492505050565b634e487b7160e01b5f52601160045260245ffd5b5f600182016106915761069161066c565b5060010190565b818382375f9101908152919050565b5f80858511156106b5575f80fd5b838611156106c1575f80fd5b5050820193919092039150565b803560208310156106e6575f19602084900360031b1b165b92915050565b634e487b7160e01b5f52603260045260245ffd5b60ff81811683821601908111156106e6576106e661066c56fea2646970667358221220befef0ffbba9994d696b7cbf8606cc6dda0e5a488ebe379619b08c1a4531e38b64736f6c63430008140033';

const NAME_REGISTRY_ABI = [
  'function resolveName(string calldata name) external view returns (bytes)',
];

const ANNOUNCER_ABI = [
  'function announce(uint256 schemeId, address stealthAddress, bytes calldata ephemeralPubKey, bytes calldata metadata) external',
];

const secp256k1 = new EC('secp256k1');

// Rate limiting with automatic cleanup
const resolveCooldowns = new Map<string, number>();
const COOLDOWN_MS = 5_000;
const MAX_COOLDOWN_ENTRIES = 1000;

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  // Periodic cleanup: if map gets large, prune expired entries
  if (resolveCooldowns.size > MAX_COOLDOWN_ENTRIES) {
    for (const [k, t] of resolveCooldowns) {
      if (now - t > COOLDOWN_MS) resolveCooldowns.delete(k);
    }
  }
  const last = resolveCooldowns.get(key);
  if (last && now - last < COOLDOWN_MS) return false;
  resolveCooldowns.set(key, now);
  return true;
}

// Custom JSON-RPC provider that bypasses Next.js fetch patching
class ServerJsonRpcProvider extends ethers.providers.JsonRpcProvider {
  async send(method: string, params: unknown[]): Promise<unknown> {
    const id = this._nextId++;
    const body = JSON.stringify({ jsonrpc: '2.0', method, params, id });

    const https = await import('https');
    const url = new URL(RPC_URL);

    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: url.hostname,
          port: url.port || 443,
          path: url.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk: Buffer) => { data += chunk; });
          res.on('end', () => {
            try {
              const json = JSON.parse(data);
              if (json.error) reject(new Error(json.error.message || 'RPC Error'));
              else resolve(json.result);
            } catch (e) {
              reject(new Error(`Invalid JSON response: ${data.slice(0, 100)}`));
            }
          });
        }
      );
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }
}

function getProvider() {
  return new ServerJsonRpcProvider(RPC_URL, { name: 'thanos-sepolia', chainId: CHAIN_ID });
}

function computeStealthWalletAddress(ownerEOA: string): string {
  const initCode = ethers.utils.solidityPack(
    ['bytes', 'bytes'],
    [STEALTH_WALLET_CREATION_CODE, ethers.utils.defaultAbiCoder.encode(['address'], [ownerEOA])]
  );
  return ethers.utils.getCreate2Address(STEALTH_WALLET_FACTORY, ethers.constants.HashZero, ethers.utils.keccak256(initCode));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pubKeyToAddress(pubPoint: any): string {
  const uncompressed = pubPoint.encode('hex', false).slice(2);
  const hash = ethers.utils.keccak256('0x' + uncompressed);
  return ethers.utils.getAddress('0x' + hash.slice(-40));
}

function isValidCompressedPublicKey(hex: string): boolean {
  return /^(02|03)[0-9a-fA-F]{64}$/.test(hex);
}

function generateStealthAddress(spendingPublicKey: string, viewingPublicKey: string) {
  const ephemeral = secp256k1.genKeyPair();
  const ephemeralPublicKey = ephemeral.getPublic(true, 'hex');

  const viewPub = secp256k1.keyFromPublic(viewingPublicKey, 'hex');
  const sharedSecret = ephemeral.derive(viewPub.getPublic()).toString('hex').padStart(64, '0');
  const secretHash = ethers.utils.keccak256('0x' + sharedSecret);
  const viewTag = secretHash.slice(2, 4);

  const spendingKey = secp256k1.keyFromPublic(spendingPublicKey, 'hex');
  const hashKey = secp256k1.keyFromPrivate(secretHash.slice(2), 'hex');
  const stealthPubPoint = spendingKey.getPublic().add(hashKey.getPublic());

  const stealthEOAAddress = pubKeyToAddress(stealthPubPoint);
  const stealthAddress = computeStealthWalletAddress(stealthEOAAddress);

  return { stealthAddress, ephemeralPublicKey, viewTag };
}

function parseMetaAddressBytes(metaBytes: string): { spendingPublicKey: string; viewingPublicKey: string } {
  const hex = metaBytes.replace(/^0x/, '');
  if (hex.length !== 132) throw new Error('Invalid meta-address length');

  const spendingPublicKey = hex.slice(0, 66);
  const viewingPublicKey = hex.slice(66, 132);

  if (!isValidCompressedPublicKey(spendingPublicKey) || !isValidCompressedPublicKey(viewingPublicKey)) {
    throw new Error('Invalid public key in meta-address');
  }

  return { spendingPublicKey, viewingPublicKey };
}

function stripTokSuffix(name: string): string {
  const n = name.toLowerCase().trim();
  return n.endsWith('.tok') ? n.slice(0, -4) : n;
}

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function GET(req: Request, { params }: { params: { name: string } }) {
  try {
    if (!SPONSOR_KEY) {
      return NextResponse.json({ error: 'Sponsor not configured' }, { status: 500 });
    }

    const { name } = params;
    const url = new URL(req.url);
    const linkSlug = url.searchParams.get('link') || undefined;

    // Rate limit by name+link
    const cooldownKey = `${name.toLowerCase()}_${linkSlug || ''}`;
    if (!checkRateLimit(cooldownKey)) {
      return NextResponse.json(
        { error: 'Please wait before resolving again' },
        { status: 429, headers: NO_STORE }
      );
    }

    const provider = getProvider();

    // 1. Resolve name → meta-address bytes (strip .tok suffix, matching names.ts)
    const registry = new ethers.Contract(NAME_REGISTRY_ADDRESS, NAME_REGISTRY_ABI, provider);
    const normalized = stripTokSuffix(name);

    const metaBytes: string | null = await (async () => {
      try {
        const result = await registry.resolveName(normalized);
        if (result && result !== '0x' && result.length > 4) return result;
      } catch {}
      return null;
    })();

    if (!metaBytes) {
      return NextResponse.json(
        { error: 'Name not found' },
        { status: 404, headers: NO_STORE }
      );
    }

    // 2. Parse meta-address → spending + viewing public keys (with validation)
    const { spendingPublicKey, viewingPublicKey } = parseMetaAddressBytes(metaBytes);

    // 3. Generate fresh stealth address (random ephemeral key)
    const { stealthAddress, ephemeralPublicKey, viewTag } = generateStealthAddress(spendingPublicKey, viewingPublicKey);

    // 4. Build metadata: viewTag + optional linkSlug hex
    let metadata = '0x' + viewTag;
    if (linkSlug) {
      const slugBytes = new TextEncoder().encode(linkSlug);
      const slugHex = Array.from(slugBytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      metadata += slugHex;
    }

    // 5. Announce on-chain (deployer pays gas)
    const sponsor = new ethers.Wallet(SPONSOR_KEY, provider);
    const announcer = new ethers.Contract(ANNOUNCER_ADDRESS, ANNOUNCER_ABI, sponsor);
    const ephPubKeyHex = '0x' + ephemeralPublicKey.replace(/^0x/, '');

    const tx = await announcer.announce(1, stealthAddress, ephPubKeyHex, metadata);
    const receipt = await tx.wait();

    console.log('[Resolve]', normalized, linkSlug || '', '→', stealthAddress, 'tx:', receipt.transactionHash);

    return NextResponse.json(
      {
        stealthAddress,
        network: 'thanos-sepolia',
        chainId: CHAIN_ID,
        announceTxHash: receipt.transactionHash,
      },
      { headers: NO_STORE }
    );
  } catch (e) {
    console.error('[Resolve] Error:', e);
    // Sanitize error messages — don't leak RPC/contract internals
    const raw = e instanceof Error ? e.message : '';
    let message = 'Resolution failed';
    if (raw.includes('Invalid meta-address')) message = 'Invalid meta-address data';
    else if (raw.includes('Invalid public key')) message = 'Corrupted registry data';
    else if (raw.includes('Name not found')) message = 'Name not found';

    return NextResponse.json(
      { error: message },
      { status: 500, headers: NO_STORE }
    );
  }
}
