import { expect } from "chai";
import { ethers } from "hardhat";
import type { MockERC20, RejectingCaller, WETH9 } from "../typechain-types";

const E18 = 10n ** 18n;

describe("Test & testnet mocks", () => {
  it("MockERC20 (EGG/FEED stand-in) has configurable decimals and an open faucet", async () => {
    const [a] = await ethers.getSigners();
    const feed = (await ethers.deployContract("MockERC20", ["Mock FEED (test only)", "mFEED", 6])) as unknown as MockERC20;
    expect(await feed.decimals()).to.equal(6);
    await feed.mint(a.address, 5_000_000n);
    expect(await feed.balanceOf(a.address)).to.equal(5_000_000n);
    // deliberately not burnable: the DEX parks its fee at 0x…dEaD
    expect(feed.interface.hasFunction("burn")).to.equal(false);
  });

  it("WETH9 wraps and unwraps 1:1, deposits on plain transfers and on unknown calls, like canonical WETH9", async () => {
    const [a, b] = await ethers.getSigners();
    const weth = (await ethers.deployContract("WETH9")) as unknown as WETH9;
    const wAddr = await weth.getAddress();
    expect([await weth.name(), await weth.symbol(), await weth.decimals()]).to.deep.equal(["Wrapped Ether", "WETH", 18n]);
    await expect(weth.deposit({ value: 3n * E18 })).to.emit(weth, "Deposit").withArgs(a.address, 3n * E18);
    await a.sendTransaction({ to: wAddr, value: E18 }); // receive()
    await a.sendTransaction({ to: wAddr, value: E18, data: "0x42966c68" + "00".repeat(32) }); // burn(0): fallback deposits
    expect(await weth.balanceOf(a.address)).to.equal(5n * E18);
    expect(await ethers.provider.getBalance(wAddr)).to.equal(5n * E18);
    await expect(weth.withdraw(2n * E18)).to.emit(weth, "Withdrawal").withArgs(a.address, 2n * E18);
    await expect(weth.withdraw(10n * E18)).to.be.revertedWithCustomError(weth, "ERC20InsufficientBalance");
    // infinite allowances are not spent by transferFrom
    await weth.approve(b.address, ethers.MaxUint256);
    await weth.connect(b).transferFrom(a.address, b.address, E18);
    expect(await weth.allowance(a.address, b.address)).to.equal(ethers.MaxUint256);
  });

  it("WETH9.withdraw reverts when the recipient refuses ETH", async () => {
    const weth = (await ethers.deployContract("WETH9")) as unknown as WETH9;
    const caller = (await ethers.deployContract("RejectingCaller")) as unknown as RejectingCaller;
    const w = await weth.getAddress();
    await caller.execute(w, E18, weth.interface.encodeFunctionData("deposit"), { value: E18 });
    await expect(caller.execute(w, 0n, weth.interface.encodeFunctionData("withdraw", [E18]))).to.be.revertedWithCustomError(weth, "ETHTransferFailed");
  });
});
