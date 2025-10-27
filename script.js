// ===================
// CONFIG
// ===================
const CONTRACT_ADDRESS = "0x56F9336f4B8BC63Bb2ac59C41Cc2ca0a3f52607c";
const FALLBACK_MAX_SUPPLY = 10000;
const SHIBARIUM = {
  chainId: "0x6d",
  chainName: "Shibarium Mainnet",
  nativeCurrency: { name: "BONE", symbol: "BONE", decimals: 18 },
  rpcUrls: ['https://rpc.shibarium.shib.io'],
  blockExplorerUrls: ['https://www.shibariumscan.io'],
};

// ===================
// STATE + UI
// ===================
let provider, signer, contractRead, contractWrite, user, CONTRACT_ABI, availableFuncs = {};
const $ = id => document.getElementById(id);
const ui = {
  network:$("network"), minted:$("minted"), remaining:$("remaining"),
  bar:$("bar"), price:$("price"), sale:$("saleState"),
  addr:$("contractAddress"), qty:$("qty"),
  mintBtn:$("mintBtn"), connectBtn:$("connectBtn"), maxBtn:$("maxBtn"),
  txMsg:$("txMsg"), err:$("err"), ok:$("ok"), status:$("status")
};
ui.addr.textContent = CONTRACT_ADDRESS;

// ===================
// FETCH ABI AND DETECT FUNCTIONS
// ===================
async function fetchABI() {
  try {
    const res = await fetch(`https://api.shibariumscan.io/api?module=contract&action=getabi&address=${CONTRACT_ADDRESS}`);
    const data = await res.json();
    if(data.status==="1") {
      CONTRACT_ABI = JSON.parse(data.result);
    } else throw new Error("Failed to fetch ABI");
  } catch(e) {
    console.warn("Fallback minimal ABI", e);
    CONTRACT_ABI = [
      "function totalSupply() view returns (uint256)",
      "function MAX_SUPPLY() view returns (uint256)",
      "function MAX_PER_TX() view returns (uint256)",
      "function MINT_PRICE() view returns (uint256)",  
      "function saleActive() view returns (bool)",
      "function mint(uint256 quantity) payable"
    ];
  }

  // Detect which functions exist
  const iface = new ethers.utils.Interface(CONTRACT_ABI);
  availableFuncs.totalSupply = iface.getFunction("totalSupply") ? true : false;
  availableFuncs.MAX_SUPPLY = iface.getFunction("MAX_SUPPLY") ? true : false;
  availableFuncs.MAX_PER_TX = iface.getFunction("MAX_PER_TX") ? true : false;
  availableFuncs.MINT_PRICE = iface.getFunction("MINT_PRICE") ? true : false;
  availableFuncs.saleActive = iface.getFunction("saleActive") ? true : false;
  availableFuncs.mint = iface.getFunction("mint") ? true : false;
}

// ===================
// PROVIDER + CONNECT
// ===================
async function ensureProvider(){
  if(!window.ethers) throw new Error("ethers.js failed");
  if(!window.ethereum) throw new Error("No wallet detected (MetaMask required)");
  provider = new ethers.providers.Web3Provider(window.ethereum,"any");
}

async function connect(){
  try{
    ui.txMsg.textContent = "Opening wallet…";
    await ensureProvider();
    await fetchABI();

    contractRead = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, provider);

    const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
    if(!accounts.length) throw new Error("No account authorized");
    user = accounts[0];

    const currentChain = await window.ethereum.request({ method:"eth_chainId" });
    if(parseInt(currentChain,16)!==109){
      try{
        await window.ethereum.request({ method:"wallet_switchEthereumChain", params:[{chainId:"0x6d"}] });
      } catch(e){
        if(e.code===4902) await window.ethereum.request({ method:"wallet_addEthereumChain", params:[SHIBARIUM] });
        else throw e;
      }
    }

    signer = provider.getSigner();
    contractWrite = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);

    ui.connectBtn.textContent = user.slice(0,6)+"…"+user.slice(-4);
    ui.mintBtn.disabled = !availableFuncs.mint;
    ui.txMsg.textContent = "";
    await refreshStats();
  } catch(e){ ui.txMsg.textContent=""; showErr(e); console.error(e); }
}

// ===================
// REFRESH STATS DYNAMICALLY
// ===================
async function refreshStats(){
  if(!contractRead) return;
  try{
    const minted = availableFuncs.totalSupply ? await contractRead.totalSupply().catch(()=>0) : 0;
    const maxSupply = availableFuncs.MAX_SUPPLY ? await contractRead.MAX_SUPPLY().catch(()=>FALLBACK_MAX_SUPPLY) : FALLBACK_MAX_SUPPLY;
    const remaining = ethers.BigNumber.from(maxSupply).sub(minted);
    ui.minted.textContent = minted.toString();
    ui.remaining.textContent = remaining.toString();
    ui.bar.style.width = Math.min(100, Number(minted.mul(100).div(maxSupply)))+"%";

    const p = availableFuncs.MINT_PRICE ? await contractRead.MINT_PRICE().catch(()=>ethers.utils.parseEther("0.1")) : ethers.utils.parseEther("0.1");
    ui.price.textContent = `${ethers.utils.formatEther(p)} BONE`;

    const live = availableFuncs.saleActive ? await contractRead.saleActive().catch(()=>false) : false;
    ui.sale.textContent = `Sale: ${live?"LIVE":"PAUSED"}`;
    ui.sale.style.background = live ? "rgba(125,255,182,.9)" : "rgba(150,160,175,.25)";
  } catch(e){ ui.status.textContent="Unable to read contract"; console.error(e); }
}

// ===================
// DYNAMIC MINT
// ===================
async function doMint(){
  try{
    if(!contractWrite){ await connect(); if(!contractWrite) throw new Error("Connect first"); }

    const maxPerTx = availableFuncs.MAX_PER_TX ? await contractRead.MAX_PER_TX().catch(()=>30) : 30;
    const q = Math.max(1, Math.min(maxPerTx, parseInt(ui.qty.value||"1",10)));
    ui.qty.value = String(q);

    const price = availableFuncs.MINT_PRICE ? await contractRead.MINT_PRICE().catch(()=>ethers.utils.parseEther("0.1")) : ethers.utils.parseEther("0.1");
    const total = price.mul(q);

    ui.txMsg.textContent = "Sending tx…";
    const tx = await contractWrite.mint(q, { value: total });
    ui.txMsg.textContent = `Tx sent: ${tx.hash.slice(0,10)}…`;
    const rcpt = await tx.wait();
    ui.ok.style.display="block";
    ui.ok.textContent=`Success! Block ${rcpt.blockNumber}`;
    ui.txMsg.textContent="";
    await refreshStats();
  } catch(e){ ui.txMsg.textContent=""; showErr(e); console.error(e); }
}

// ===================
// INIT
// ===================
async function init(){
  await ensureProvider();
  await fetchABI();
  contractRead = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, provider);
  await refreshStats();
  setInterval(refreshStats,10000);

  ui.connectBtn.addEventListener("click", connect);
  ui.maxBtn.addEventListener("click", async ()=>{
    const maxPerTx = availableFuncs.MAX_PER_TX ? await contractRead.MAX_PER_TX().catch(()=>30) : 30;
    ui.qty.value = maxPerTx.toString();
  });
  ui.mintBtn.addEventListener("click", doMint);
}

init();

// ===================
// ERROR HANDLER
// ===================
function showErr(e){ ui.err.style.display="block"; ui.err.textContent=e.message||e; setTimeout(()=>{ui.err.style.display="none"},5000); }
