// ===================
// CONFIG
// ===================
const CONTRACT_ADDRESS = "0x9e4C1a31c8fD1a9d10fBFC81C1d6A95b2BafbDe8";
const BONE_ADDRESS = "0x0000000000000000000000000000000000001010";
const FALLBACK_MAX_SUPPLY = 10000;
const SHIBARIUM = {
  chainId:  "0x9d", // 157 in hex
  chainName: "Puppynet Testnet",
  nativeCurrency: { name: "BONE", symbol: "BONE", decimals: 18 },
  rpcUrls: ['https://api.shibrpc.com/puppynet/'],
  blockExplorerUrls: ['https://puppyscan.shib.io/'],
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
// ERROR HANDLER
// ===================
function showErr(e){
  ui.err.style.display="block";
  ui.err.textContent = e.message || e;
  console.error(e);
  setTimeout(()=>{ui.err.style.display="none"},5000);
}
function showOk(m){
  ui.ok.style.display="block";
  ui.ok.textContent = m;
  setTimeout(()=>ui.ok.style.display="none",5000);
}

// ===================
// FETCH ABI AND DETECT FUNCTIONS
// ===================
async function fetchABI() {
  try {
    const res = await fetch(`https://api.shibariumscan.io/api?module=contract&action=getabi&address=${CONTRACT_ADDRESS}`);
    const data = await res.json();
    if(data.status==="1") CONTRACT_ABI = JSON.parse(data.result);
    else throw new Error("Failed to fetch ABI");
  } catch(e) {
    console.warn("Fallback minimal ABI", e);
    CONTRACT_ABI = [
      "function totalSupply() view returns (uint256)",
      "function MAX_SUPPLY() view returns (uint256)",
      "function MAX_PER_TX() view returns (uint256)",
      "function MAX_PER_WALLET() view returns (uint256)",
      "function MINT_PRICE() view returns (uint256)",  
      "function saleActive() view returns (bool)",
      "function mintedBy(address) view returns (uint256)",
      "function mint(uint256 quantity) payable"
    ];
  }

  // Detect functions availability
  const iface = new ethers.utils.Interface(CONTRACT_ABI);
  ["totalSupply","MAX_SUPPLY","MAX_PER_TX","MAX_PER_WALLET","MINT_PRICE","saleActive","mint","mintedBy"]
    .forEach(f => availableFuncs[f] = iface.getFunction(f) ? true : false);
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
      try{ await window.ethereum.request({ method:"wallet_switchEthereumChain", params:[{chainId:"0x6d"}] }); }
      catch(e){
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
// REFRESH STATS
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
    ui.sale.textContent = live ? "Active" : "Closed";
  } catch(e){ ui.status.textContent="Unable to read contract"; console.error(e); }
}

// ===================
// USER LIMITS
// ===================
async function updateUserLimits(){
  if(!contractRead) return 1;
  try{
    const maxPerTx = availableFuncs.MAX_PER_TX ? await contractRead.MAX_PER_TX().catch(()=>30) : 30;
    const maxPerWallet = availableFuncs.MAX_PER_WALLET ? await contractRead.MAX_PER_WALLET().catch(()=>30) : 30;
    const mintedByUser = availableFuncs.mintedBy ? await contractRead.mintedBy(user).catch(()=>0) : 0;
    const totalSupply = availableFuncs.totalSupply ? await contractRead.totalSupply().catch(()=>0) : 0;
    const maxSupply = availableFuncs.MAX_SUPPLY ? await contractRead.MAX_SUPPLY().catch(()=>FALLBACK_MAX_SUPPLY) : FALLBACK_MAX_SUPPLY;

    const remainingWallet = maxPerWallet - mintedByUser;
    const remainingTotal = maxSupply - totalSupply;
    const allowedMax = Math.min(maxPerTx, remainingWallet, remainingTotal);
    ui.qty.max = allowedMax > 0 ? allowedMax : 1;
    return allowedMax;
  } catch(e){ console.warn(e); return 1; }
}

// ===================
// MINT NFT
// ===================
async function doMint(){
  try{
    if(!contractWrite) { await connect(); if(!contractWrite) throw new Error("Connect first"); }

    const maxQty = await updateUserLimits();
    let qty = parseInt(ui.qty.value);
    if(isNaN(qty) || qty < 1) qty = 1;
    if(qty > maxQty) qty = maxQty;
    ui.qty.value = qty;

    if(!availableFuncs.MINT_PRICE) throw new Error("MINT_PRICE function missing");

    const price = await contractRead.MINT_PRICE();
    const total = price.mul(qty);

    // ===================
    // CHECK & APPROVE BONE
    // ===================
    const BONE = new ethers.Contract(
      BONE_ADDRESS,
      ["function allowance(address owner,address spender) view returns(uint256)",
       "function approve(address spender,uint256 amount) returns(bool)"],
      signer
    );

    let allowance = ethers.BigNumber.from(0);
    try {
      allowance = await BONE.allowance(user, CONTRACT_ADDRESS);
    } catch(e){
      console.warn("Allowance check failed, will request approval anyway", e);
    }

    if(allowance.lt(total)){
      ui.txMsg.textContent = "Requesting BONE approval…";
      try {
        const approveTx = await BONE.approve(CONTRACT_ADDRESS, total);
        await approveTx.wait();
        ui.txMsg.textContent = "✅ Approval successful!";
      } catch(e) {
        ui.txMsg.textContent = "";
        throw new Error("BONE approval failed: " + (e.message || e));
      }
    }

    // ===================
    // MINT
    // ===================
    ui.txMsg.textContent = `Minting ${qty} NFT(s)…`;
    const tx = await contractWrite.mint(qty);
    await tx.wait();

    ui.txMsg.textContent = "";
    showOk(`✅ Mint successful! Quantity: ${qty}`);
    await refreshStats();
  } catch(e){ ui.txMsg.textContent=""; showErr(e); console.error(e); }
}

// ===================
// FLOATING IMAGES
// ===================
const leftImagesArray = ["chika1.png","chika2.png","chika3.png"];
const rightImagesArray = ["chika4.png","chika5.png","chika6.png"];
const leftContainer = document.getElementById("leftImages");
const rightContainer = document.getElementById("rightImages");
const leftImg = new Image();
const rightImg = new Image();
leftContainer.appendChild(leftImg);
rightContainer.appendChild(rightImg);
function randomImage(arr){ return arr[Math.floor(Math.random()*arr.length)]; }
function updateImages(){ leftImg.src=randomImage(leftImagesArray); rightImg.src=randomImage(rightImagesArray); }
updateImages(); setInterval(updateImages,3000);

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
  ui.maxBtn.addEventListener("click", async ()=>{ ui.qty.value = await updateUserLimits(); });
  ui.mintBtn.addEventListener("click", doMint);
}

init();


