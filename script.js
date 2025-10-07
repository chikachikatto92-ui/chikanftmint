// ==================
// ⚙️ CONFIG
// ==================
const CONTRACT_ADDRESS = "0xC7faEE890862A86EE391c756597173B9922245D6"; 
const FALLBACK_MAX_SUPPLY = 10000;
const SHIBARIUM = {
  chainId: "0x9d", // hex for 157
  chainName: "Puppynet Testnet",
  nativeCurrency: { name: "BONE", symbol: "BONE", decimals: 18 },
  rpcUrls: ["https://puppynet.shibrpc.com"],
  blockExplorerUrls: ["https://puppyscan.shib.io/"]
};

// ==================
// STATE + UI
// ==================
let provider, signer, contractRead, contractWrite, user;
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
// MINIMAL ABI
// ===================
const CONTRACT_ABI = [
  "function totalSupply() view returns (uint256)",
  "function MAX_SUPPLY() view returns (uint256)",
  "function MAX_PER_TX() view returns (uint256)",
  "function MINT_PRICE() view returns (uint256)",  
  "function saleActive() view returns (bool)",
  "function mint(uint256 quantity) payable"
];

// ===================
// PROVIDER + CONNECT
// ===================
async function ensureProvider(){
  if (!window.ethers) throw new Error("ethers.js failed to load");
  if (!window.ethereum) throw new Error("No wallet detected (install MetaMask)");
  provider = new ethers.providers.Web3Provider(window.ethereum,"any");
}

async function connect(){
  try{
    ui.txMsg.textContent = "Opening wallet…";
    await ensureProvider();

    contractRead = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, provider);

    const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
    if (!accounts.length) throw new Error("No account authorized");
    user = accounts[0];

    const currentChain = await window.ethereum.request({ method: "eth_chainId" });
    if (parseInt(currentChain,16) !== 157){  
      try{
        await window.ethereum.request({ 
          method: "wallet_switchEthereumChain", 
          params:[{ chainId:"0x9d" }] 
        });
      }catch(e){
        if(e.code===4902){
          await window.ethereum.request({ method:"wallet_addEthereumChain", params:[SHIBARIUM] });
        }else{ throw e; }
      }
    }

    signer = provider.getSigner();
    contractWrite = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);

    ui.connectBtn.textContent = user.slice(0,6)+"…"+user.slice(-4);
    ui.mintBtn.disabled = false;
    ui.txMsg.textContent = "";
    await refreshStats();
  }catch(e){ ui.txMsg.textContent=""; showErr(e); console.error(e); }
}

// ===================
// REFRESH STATS
// ===================
async function refreshStats(){
  if(!contractRead) return;
  try{
    const minted = await contractRead.totalSupply().catch(()=>0);
    const maxSupply = await contractRead.MAX_SUPPLY().catch(()=>FALLBACK_MAX_SUPPLY);
    const remaining = ethers.BigNumber.from(maxSupply).sub(minted);
    ui.minted.textContent = minted.toString();
    ui.remaining.textContent = remaining.toString();
    const pct = Math.min(100, Number(minted.mul(100).div(maxSupply)));
    ui.bar.style.width = pct+"%";

    const p = await contractRead.MINT_PRICE().catch(()=>ethers.utils.parseEther("0.1"));
    ui.price.textContent = p ? `${ethers.utils.formatEther(p)} BONE` : "—";

    const live = await contractRead.saleActive().catch(()=>false);
    ui.sale.textContent = `Sale: ${live?"LIVE":"PAUSED"}`;
    ui.sale.style.background = live ? "rgba(125,255,182,.9)" : "rgba(150,160,175,.25)";
  }catch(e){ ui.status.textContent="Unable to read contract."; console.error(e); }
}

// ===================
// DO MINT
// ===================
async function doMint(){
  try{
    if(!contractWrite){ await connect(); if(!contractWrite) throw new Error("Connect first"); }

    const maxPerTx = await contractRead.MAX_PER_TX().catch(()=>30);
    const q = Math.max(1, Math.min(maxPerTx, parseInt(ui.qty.value||"1",10)));
    ui.qty.value = String(q);

    const p = await contractRead.MINT_PRICE().catch(()=>ethers.utils.parseEther("0.1"));
    const total = p.mul(q);

    ui.txMsg.textContent = "Sending tx…";
    const tx = await contractWrite.mint(q, { value: total });
    ui.txMsg.textContent = `Tx sent: ${tx.hash.slice(0,10)}…`;
    const rcpt = await tx.wait();
    ui.ok.style.display="block";
    ui.ok.textContent=`Success! Block ${rcpt.blockNumber}`;
    ui.txMsg.textContent="";
    await refreshStats();
  }catch(e){ ui.txMsg.textContent=""; showErr(e); console.error(e); }
}

// ===================
// INIT
// ===================
async function init(){
  await ensureProvider();
  contractRead = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, provider);
  await refreshStats();
  setInterval(refreshStats,10000);

  ui.connectBtn.addEventListener("click",connect);
  ui.maxBtn.addEventListener("click", async ()=>{
    const maxPerTx = await contractRead.MAX_PER_TX().catch(()=>30);
    ui.qty.value = maxPerTx.toString();
  });
  ui.mintBtn.addEventListener("click",doMint);
}
init();


const leftImagesContainer = document.getElementById("leftImages");
const rightImagesContainer = document.getElementById("rightImages");


