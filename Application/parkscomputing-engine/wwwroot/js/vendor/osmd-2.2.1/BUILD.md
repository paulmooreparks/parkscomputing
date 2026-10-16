# OpenSheetMusicDisplay for Sight Reader

`osmd.js` is OpenSheetMusicDisplay 2.2.1 (BSD-3-Clause), vendored unmodified. It is `build/opensheetmusicdisplay.min.js` from the `opensheetmusicdisplay@2.2.1` package on npm, and it defines the global `opensheetmusicdisplay`. It bundles VexFlow 1.2.93 and the other libraries `LICENSE.txt` lists, each with its licence. The Sight Reader applet (`js/sight-reader.js`, `Architecture/sight-reader-design.md`) loads it only when the applet opens.

Fetched on 2026-10-17 with:

```
npm pack opensheetmusicdisplay@2.2.1
tar -xzf opensheetmusicdisplay-2.2.1.tgz
cp package/build/opensheetmusicdisplay.min.js osmd.js
```

It is 1.4 MB, or about 360 KB compressed. Version 2.2.1 is the one whose documented API the applet is written against: `GraphicalNote.setColor`, which marks a note without drawing the score again, is not in 1.9.0.

To upgrade, repeat this in a new directory named for the version, check the applet's tests against it, rebuild `LICENSE.txt` from the new package's dependencies, and update the path in `js/sight-reader.js`.
