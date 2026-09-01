/**
 * Inert entry point for the simulator package.
 *
 * This file exists only to verify that the TypeScript toolchain compiles
 * under strict NodeNext settings. No simulator logic lives here yet.
 */
export function main(): void {
  console.log("simulator scaffold ready");
}

if (require.main === module) {
  main();
}
