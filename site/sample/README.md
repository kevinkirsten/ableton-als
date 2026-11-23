# The demo's sample set

`Demo Set.als` is what the page opens when a visitor clicks "Open the sample
set". It is a real Live Set: **saved by Ableton Live 12.4.3**, not generated.
That matters because whatever the page produces from it (a repaired set, a
converted one) has to open in Live, and only a document Live wrote itself is a
fair starting point for that claim.

It contains nothing third-party. The audio it references is ten short tones
synthesized with ffmpeg (`make-audio.sh`), and the audio is not in the
repository: the set only names the files, under `/Volumes/Demo SSD/…`. Opened
on any other machine, Live reports them missing, which is expected.

## How it was made

1. **In Live 12.4.3:** a new set, seven more audio tracks, four more scenes.
   Each audio file was imported into a clip slot, and two empty MIDI clips
   were created. Saved from Live.
2. **`arrange.ts`:** names the tracks and scenes, programs scene tempo and
   time signature, and clones the clips Live wrote into other scenes, changing
   a few values on the copies (colour, follow action, loop length). It invents
   no element. It also leaves the stems warped at 60 BPM in a 120 BPM set, so
   the repair tools have something real to do.
3. **In Live 12.4.3 again:** the arranged file was opened and saved. The
   committed `Demo Set.als` is that save, byte for byte.

To rebuild it, mount a volume named `Demo SSD`, run `make-audio.sh`, repeat
step 1, then:

```bash
npx tsx site/sample/arrange.ts "<the set saved in step 1>.als" arranged.als
```

and open `arranged.als` in Live 12 and save it as `Demo Set.als`.

## What it carries on purpose

| | |
|---|---|
| Clips warped at 60 BPM, set at 120 | `rewarpClips` |
| GUITAR loops half of what DRUMS loops, in five scenes | `mirrorTrackGeometry`; until then `syncFollowActions` is blocked |
| Follow actions off, linked and mistimed | `syncFollowActions` |
| One clip on follow action Jump | a `jump_follow_action` warning on conversion |
| One audio file outside the library folder | a `samples_outside_root` warning |
| A scene named `INTERLUDE "B"` | Live writes that attribute in single quotes |
| A file name longer than 31 characters | the shortened name in the alias record |

The damaged variant ("Open a damaged one") is this same document with
structural damage planted by `site/src/sample.ts` when the visitor asks for
it. Live would refuse that one, so the page never offers a file made from it.

## Measured in Live

On 2026-11-23, with the audio on a mounted volume, the page's conversion of
this set opened in Live 10.1.43 with every clip loaded, and the repaired set
opened in Live 12.4.3. See `docs/specs/HANDOFF.md` for the full account,
including which kinds of volume the alias records resolve on.
