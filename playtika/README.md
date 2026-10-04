# Original game files

The files in this folder belong to Playtika and JustPlay.LOL, who made 1v1.LOL. They are the original WebGL build 4.713 and its Addressables content 4.701, byte for byte as they were served. 1v1.LOL has shut down and its CDN no longer serves the build, so they are kept here to let the game be played offline after the shutdown.

They are not covered by this project's MIT license, and this project claims no rights over them.

The paths are those of `artifacts/original/`. A file over 45 MB is stored as `<name>.part-00`, `.part-01`, … of at most 45,000,000 bytes each; today that is only `WebGL.data.unityweb`, in five parts. `bun run setup` joins the parts, checks every file against its pin (`src/host/build/pins.ts` and `src/host/build/inputs.ts`) and derives `artifacts/extracted/` from them. `bun run setup --pack` writes this folder from a verified `artifacts/original/`.
