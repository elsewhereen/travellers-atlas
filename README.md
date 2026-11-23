# Traveller's Atlas

*A No Man's Sky companion that runs in your browser.*

**It runs entirely on your own machine.** Traveller's Atlas is a plain HTML page: no installation, no server, no account, and no internet needed. Download it, open `index.html`, and that's it. Your saves are read in your browser, and nothing ever leaves your computer.

[![CodeQL](https://github.com/elsewhereen/travellers-atlas/actions/workflows/github-code-scanning/codeql/badge.svg)](https://github.com/elsewhereen/travellers-atlas/actions/workflows/github-code-scanning/codeql)

Every push is scanned with GitHub's CodeQL for security problems, and with secret scanning for leaked keys.

## Motivation

Space is big, and in NMS it feels even bigger. I wanted a sense of belonging somewhere: a clear, easily accessible picture of where I'd been, in a way the game never gave me.

Along the way came other things. Searching for resources without any idea of where to look, or having to search the web for clues. A character sheet showing the progress the game hides from you or only shows now and then. And an optimizer for module placement: I knew the basics, but I didn't want to sit with a calculator just to outfit my multi-tool, ship
or Exosuit.

I now use this tool while I play, and I hope you'll find it useful too. Feel free to fork it and extend it to your heart's content.

## What is included

Point it at your No Man's Sky save folder and it shows:

- **A 3D map of the space you know.** Every system you've visited or discovered sits at its exact position, computed from its address with the same algorithms the game uses. The distance to the galactic centre and between systems matches the galaxy map.
- **Systems and planets from the address alone.** Each system shows its name, race, economy, conflict level and star colour, and each planet its biome, size, weather, sentinels, resources and whether it has Salvageable Scrap. This works for systems you haven't visited too.
- **A system view** (press G on a system's card): the station in the middle and every planet and moon around it, placed in the game's own order and directions, with a card for each body.
- **A filter** that finds the nearest systems with the resources or station goods you need.
- **A character sheet.** It shows your standing, ranks, ships, multi-tools and freighter with their stats, how good each roll is for its class, and an optimizer for tech layouts (supercharged slots and adjacency).
- **Distances** from where you are to any portal address.

No save file, or playing on a console? Type the portal glyphs of the system you're in (photo mode shows them) and the map works from those.

## Running it

**Run it locally:** download [the latest version as a zip](https://github.com/elsewhereen/travellers-atlas/archive/refs/heads/main.zip), unpack it and open `index.html` in a browser. That's all. There is no build step, no installation and no server, and it works offline. Everything it needs, fonts included, is in the folder.

As with anything you download, scan the zip with your own virus scanner before you open it. It contains only text files (HTML, CSS and JavaScript) and the font files, so there is nothing to install or run outside the browser.

**Or use it online:** https://elsewhereen.github.io/travellers-atlas/ always has the latest version. Only the page itself comes from the internet; your saves still never leave your computer.

Choosing your saves:

- **Chromium-based browsers** (Chrome, Edge, Brave …) remember the save folder between visits.
- **Firefox** can't remember folders, so you choose the folder again each visit.
- **In any browser** you can also drag the save folder, or single save files, onto the page.

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

## How it was made

This app was built with AI. The code, the research into how the game generates its galaxy, and most of the writing came from conversations with Claude (Anthropic) in Claude Code. I set the direction, played the game alongside it, and checked the results: positions against the galaxy map, planets against what I found on the ground, and the character sheet against my own saves. The generators were also compared with the game's own results, system by system and planet by planet, so they don't rest on the AI's word alone.

## Credits

- [nms-core](https://github.com/elegra1965-source) (MIT) by elegra1965 for system names, which is ported from [nms_namegen](https://github.com/hadsh/nms_namegen) (MIT)
- [three.js](https://threejs.org/) (MIT) for the 3D map
- [fzstd](https://github.com/101arrowz/fzstd) (MIT) for zstd decompression
- The [Exo 2](https://github.com/googlefonts/Exo-2.0) and [Jura](https://github.com/ossobuffo/jura) fonts (SIL Open Font License)
- [bcdec](https://github.com/iOrange/bcdec) (Unlicense) for the BC7 texture decoder, which `lib/dds.js` ports
- [hgpaktool](https://pypi.org/project/hgpaktool/) (MIT) for describing the game's pak format

## Disclaimer

Traveller's Atlas is an unofficial, free and non-commercial fan tool. It is not affiliated with or endorsed by Hello Games. No Man's Sky and its names, images and game data belong to Hello Games.

## License

The code in this repository is MIT licensed (see `LICENSE`). Bundled libraries in `vendor/` keep their own licenses.
