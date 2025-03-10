import { facetMainnet, facetSepolia } from "@0xfacet/sdk/viem";
import { createPublicClient, getAddress, http } from "viem";

const L2_L1_BLOCK_CONTRACT = getAddress(
  "0x4200000000000000000000000000000000000015"
);

/**
 * Retrieves the FCT mint rate from the L1 block contract.
 *
 * @param l1ChainId - The chain ID of the L1 network (1 for Ethereum mainnet, 11155111 for Sepolia testnet)
 * @param blockNumber - Optional block number to query the mint rate at a specific block
 * @returns A Promise that resolves to the FCT mint rate as a bigint
 */
export const getFctMintRate = async (
  l1ChainId: 1 | 11155111,
  blockNumber?: bigint | number
) => {
  if (l1ChainId !== 1 && l1ChainId !== 11155111) {
    throw new Error("Invalid chain id");
  }

  const facetPublicClient = createPublicClient({
    chain: l1ChainId === 1 ? facetMainnet : facetSepolia,
    transport: http(),
  });

  const fctMintRate = await facetPublicClient.readContract({
    address: L2_L1_BLOCK_CONTRACT,
    abi: [
      {
        inputs: [],
        name: "fctMintRate",
        outputs: [
          {
            internalType: "uint128",
            name: "",
            type: "uint128",
          },
        ],
        stateMutability: "view",
        type: "function",
      },
    ],
    functionName: "fctMintRate",
    blockNumber: blockNumber !== undefined ? BigInt(blockNumber) : undefined,
  });

  return fctMintRate;
};
