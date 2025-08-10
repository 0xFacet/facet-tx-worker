import { createPublicClient, http, Hex, Address, fromRlp } from 'viem';
import { mainnet, sepolia } from 'viem/chains';
import { applyL1ToL2Alias, computeFacetTransactionHash, decodeFacetEncodedTransaction, facetMainnet, facetSepolia } from '@0xfacet/sdk';

const FACET_INBOX_ADDRESS = '0x00000000000000000000000000000000000FacE7' as const;
const FACET_EVENT_SIGNATURE = '0x00000000000000000000000000000000000000000000000000000000000face7' as const;

export default {
	async fetch(request: Request): Promise<Response> {
		try {
			const url = new URL(request.url);
			const l1TransactionHash = url.searchParams.get('txHash') as Hex;
			const l1ChainId = Number(url.searchParams.get('chainId'));

			if (!l1TransactionHash || !l1ChainId) {
				return new Response(JSON.stringify({ error: 'Missing txHash or chainId' }), { status: 400 });
			}

			if (l1ChainId !== 1 && l1ChainId !== 11155111) {
				return new Response(JSON.stringify({ error: 'Invalid chainId' }), { status: 400 });
			}

			// Set up the viem public client based on the L1 chain ID
			const l1PublicClient = createPublicClient({
				chain: l1ChainId === 1 ? mainnet : sepolia,
				transport: http(),
			});

			// Set up the viem public client for L2 chain
			const l2PublicClient = createPublicClient({
				chain: l1ChainId === 1 ? facetMainnet : facetSepolia,
				transport: http(),
			});

			// Fetch transaction details
			const transaction = await l1PublicClient.getTransaction({
				hash: l1TransactionHash,
			});

			if (!transaction) {
				return new Response(JSON.stringify({ error: 'Transaction not found' }), { status: 404 });
			}

			let to: Address | undefined;
			let value: bigint | undefined;
			let data: Hex | undefined;
			let gasLimit: bigint | undefined;
			let fromAddress: Address;

			// Check if transaction was sent to Facet Inbox (EOA case) or from a contract (contract case with event)
			if (transaction.to?.toLowerCase() === FACET_INBOX_ADDRESS.toLowerCase()) {
				// EOA case - transaction sent directly to Facet Inbox
				fromAddress = transaction.from as Address;
				const decodedTransaction = await decodeFacetEncodedTransaction(transaction.input);
				to = decodedTransaction.to;
				value = decodedTransaction.value;
				data = decodedTransaction.data;
				gasLimit = decodedTransaction.gasLimit;
			} else {
				// Contract case - need to find the event with FACET_EVENT_SIGNATURE
				const receipt = await l1PublicClient.getTransactionReceipt({
					hash: l1TransactionHash,
				});

				// Find event with the Facet signature
				const facetEvent = receipt.logs.find((log) => log.topics.length === 1 && log.topics[0] === FACET_EVENT_SIGNATURE);

				if (!facetEvent) {
					return new Response(JSON.stringify({ error: 'No Facet event found in transaction' }), { status: 400 });
				}

				// The from address is the L1-to-L2 alias of the contract address
				fromAddress = applyL1ToL2Alias(facetEvent.address);

				// The event data contains the full transaction payload
				const payload = facetEvent.data;

				// The first byte (2 hex characters after 0x) is the facetTxType (0x46)
				// The rest is the RLP encoded transaction data
				const rlpData = `0x${payload.slice(4)}` as Hex; // Remove 0x46 prefix

				// Decode the RLP data to get the transaction parameters
				const decoded = fromRlp(rlpData);

				if (!Array.isArray(decoded) || decoded.length < 6) {
					throw new Error('Invalid RLP data in Facet event');
				}

				// Extract parameters from the decoded RLP
				const toAddressBytes = decoded[1] as Hex;
				to = toAddressBytes.length <= 2 ? undefined : (toAddressBytes as Address); // Empty bytes become undefined

				// Handle empty hex strings for value
				const valueHex = decoded[2] as Hex;
				value = valueHex && valueHex !== '0x' ? BigInt(valueHex) : 0n;

				// Handle empty hex strings for gasLimit
				const gasLimitHex = decoded[3] as Hex;
				gasLimit = gasLimitHex && gasLimitHex !== '0x' ? BigInt(gasLimitHex) : 0n;

				data = decoded[4] as Hex;
			}

			// Compute the Facet transaction hash
			const facetTransactionHash = computeFacetTransactionHash(
				l1TransactionHash,
				fromAddress,
				to ?? '0x',
				value ?? 0n,
				data ?? '0x',
				gasLimit ?? 0n
			);

			// Try to fetch the transaction to verify the hash is valid
			try {
				const facetTransaction = await l2PublicClient.getTransaction({
					hash: facetTransactionHash,
				});

				if (!facetTransaction) {
					return new Response(JSON.stringify({ error: 'Facet transaction not found' }), { status: 404 });
				}
			} catch (error) {
				return new Response(JSON.stringify({ error: 'Facet transaction not found' }), { status: 404 });
			}

			return new Response(
				JSON.stringify({
					facetTransactionHash,
				}),
				{
					headers: { 'Content-Type': 'application/json' },
				}
			);
		} catch (error) {
			return new Response(JSON.stringify({ error: (error as Error).message }), { status: 500 });
		}
	},
};
