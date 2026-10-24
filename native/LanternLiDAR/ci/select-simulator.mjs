import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";

const inventory = JSON.parse(execFileSync("xcrun", ["simctl", "list", "devices", "available", "--json"], { encoding: "utf8" }));
const runtimes = Object.keys(inventory.devices).filter(key => key.includes(".iOS-")).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
const device = runtimes.flatMap(runtime => inventory.devices[runtime]).find(item => item.isAvailable && item.name.startsWith("iPhone"));
if (!device) throw new Error("No available iPhone simulator runtime. Install an iOS simulator in Xcode or use a runner with one.");
if (!/^[0-9a-f-]{36}$/i.test(device.udid)) throw new Error("Unexpected simulator identifier");
console.log(`Using ${device.name} (${device.udid}). This tests software, not LiDAR hardware.`);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `udid=${device.udid}\n`);
