# Traveller's Atlas

*A No Man's Sky companion that runs in your browser.*

## Why I made this

<!-- TODO: the motivation goes here -->

*(Coming soon.)*

## What it does

Point it at your No Man's Sky save folder and it shows:

- **A 3D map of the space you know.** Every system you've visited or discovered sits at its exact position, computed from its address with the same algorithms the game uses. The distance to the galactic centre and between systems matches the galaxy map.
- **Systems and planets from the address alone.** Each system shows its name, race, economy, conflict level and star colour, and each planet its biome, size, weather, sentinels, resources and whether it has Salvageable Scrap. This works for systems you haven't visited too.
- **A filter** that finds the nearest systems with the resources or station goods you need.
- **A character sheet.** It shows your standing, ranks, ships, multi-tools and freighter with their stats, how good each roll is for its class, and an optimizer for tech layouts (supercharged slots and adjacency).
- **Distances** from where you are to any portal address.

No save file, or playing on a console? Type the portal glyphs of the system you're in (photo mode shows them) and the map works from those.

## Running it

It is a plain static web page with no build step and no server. Open `index.html` in a browser, or serve the folder with any static file server.

- **Chromium-based browsers** (Chrome, Edge, Brave …) remember the save folder between visits.
- **Firefox** can't remember folders, so you choose the folder again each visit. You can also drag the save folder onto the page.

The save folder is usually:

| Store | Path |
|---|---|
| Steam, Windows | `%APPDATA%\HelloGames\NMS\st_<your Steam ID>` |
| GOG, Windows | `%APPDATA%\HelloGames\NMS\DefaultUser` |
| Steam (Proton), Linux | `~/.local/share/Steam/steamapps/compatdata/275850/pfx/drive_c/users/steamuser/AppData/Roaming/HelloGames/NMS/st_<your Steam ID>` |
| Heroic (GOG), Linux | `~/Games/Heroic/Prefixes/No Mans Sky/drive_c/users/steamuser/AppData/Roaming/HelloGames/NMS/DefaultUser` |

Everything happens on your computer. Your saves are only read, never changed, and nothing is uploaded anywhere.

## Game icons come from your own copy of the game

This repository contains none of the game's art. To see the game's own item icons and portal glyphs, open **Settings → Icons** and choose `NMSARC.TexUI.pak` from your installation (`GAMEDATA/PCBANKS/`). The app reads the icons it needs straight out of that file in your browser and keeps them in the browser's storage. Without them you get simple stand-ins (chemical symbols, initials, glyph numbers).

This works with the PC version (Steam and GOG), whose paks are zstd-compressed.

## Accuracy

Positions, system and planet data are re-implementations of the game's procedural generation, checked against the game. A game update can change the game's rules, and then some values may be wrong until the app is updated.

## Credits

- [nms-core](https://github.com/elegra1965-source) (MIT) by elegra1965 for system names, which is ported from [nms_namegen](https://github.com/hadsh/nms_namegen) (MIT)
- [three.js](https://threejs.org/) (MIT) for the 3D map
- [fzstd](https://github.com/101arrowz/fzstd) (MIT) for zstd decompression
- [bcdec](https://github.com/iOrange/bcdec) (Unlicense) for the BC7 texture decoder, which `lib/dds.js` ports
- [hgpaktool](https://pypi.org/project/hgpaktool/) (MIT) for describing the game's pak format

## Disclaimer

Traveller's Atlas is an unofficial, free and non-commercial fan tool. It is not affiliated with or endorsed by Hello Games. No Man's Sky and its names, images and game data belong to Hello Games.

## License

The code in this repository is MIT licensed (see `LICENSE`). Bundled libraries in `vendor/` keep their own licenses.
