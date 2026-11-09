import urllib.request
import json
import sys

hashes = [
    ("0x0b476df1d26079224c1d37e64d7f9506c906f70671525cbed317a4816e785d4e", "Slippage Protection Exceeded"),
    ("0x40cf7e708148a3e75f98a77138b6a9560258d91c96ced246cfb4dbfd01338c52", "Contract Assertion Revert Reason"),
    ("0x8ebbdfaf1ce0b3a498936ba1c73307d6b157264571111a803e69947ae219a349", "Protocol Custom Error Revert"),
]

headers = {
    "Content-Type": "application/json",
    "x-vercel-protection-bypass": "0EQDvX4Lz0Goelx6ANE75iHDLk8WZ9Yo",
}

print("=== TESTING PRODUCTION HEALTH ENDPOINT ===")
req_health = urllib.request.Request("https://pharos-dapp-support-agent.vercel.app/api/health", headers=headers)
with urllib.request.urlopen(req_health, timeout=15) as resp:
    data = json.loads(resp.read().decode("utf-8"))
    print(f"Health Status: {data.get('status')}")
    print(f"Chain MCP Status: {data.get('mcpStatus')}")
    print(f"Latest Block: {data.get('chainInfo', {}).get('latestBlock')}")
    print(f"Chain ID: {data.get('chainInfo', {}).get('chainId')}")
print()

for tx_hash, label in hashes:
    print(f"=== TESTING {label.upper()} ===")
    print(f"Hash: {tx_hash}")
    body = json.dumps({"txHash": tx_hash, "network": "pacific"}).encode("utf-8")
    req = urllib.request.Request(
        "https://pharos-dapp-support-agent.vercel.app/api/diagnose",
        data=body,
        headers=headers,
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        res = json.loads(resp.read().decode("utf-8"))
        cat = res.get("category")
        cat_lbl = res.get("categoryLabel")
        err = res.get("decodedError") or {}
        err_str = err.get("reason") or err.get("customErrorName") or err.get("signature")
        res_summary = res.get("resolution", {}).get("summary")
        block = res.get("evidence", {}).get("blockNumber")
        gas_used = res.get("gas", {}).get("gasUsed")
        gas_limit = res.get("gas", {}).get("gasLimit")

        print(f"HTTP Status: {resp.status} OK")
        print(f"Diagnosed Category: {cat} ({cat_lbl})")
        print(f"Decoded Error: {err_str}")
        print(f"Gas: {gas_used} / {gas_limit}")
        print(f"Block: {block}")
        print(f"Plain English: {res_summary}")
        print(f"Resolution Steps ({len(res.get('resolution', {}).get('actionableSteps', []))}):")
        for s in res.get("resolution", {}).get("actionableSteps", []):
            print(f"  - {s}")
        print()
print("ALL PRODUCTION SMOKE TESTS PASSED!")
