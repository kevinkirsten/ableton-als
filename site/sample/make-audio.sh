#!/bin/bash
# Synthesizes the sample set's audio: original tones, nothing recorded.
set -e
V="/Volumes/Demo SSD"
find "$V" -name "*.wav" -delete
mkdir -p "$V/Library/Click" "$V/Library/Drums" "$V/Library/Bass" "$V/Library/Keys & Pads" "$V/Library/Guitars" "$V/Library/Vocals" "$V/Loose"
gen() { ffmpeg -v error -y -f lavfi -i "aevalsrc=${2}:s=44100" -t "${3}" -ac 1 -c:a pcm_s16le "${1}"; }
gen "$V/Library/Click/click_4-4_one_bar.wav" "0.6*sin(2*PI*(1000+800*lt(mod(t\,2)\,0.5))*t)*lt(mod(t\,0.5)\,0.03)" 2
gen "$V/Library/Click/click_3-4_one_bar.wav" "0.6*sin(2*PI*(1000+800*lt(mod(t\,1.5)\,0.5))*t)*lt(mod(t\,0.5)\,0.03)" 1.5
gen "$V/Library/Click/click_6-8_one_bar.wav" "0.6*sin(2*PI*(1000+800*lt(mod(t\,1.5)\,0.25))*t)*lt(mod(t\,0.25)\,0.02)" 1.5
gen "$V/Library/Drums/drums_stem.wav" "0.5*(random(0)*2-1)*exp(-28*mod(t\,0.5))+0.7*sin(2*PI*55*t)*exp(-18*mod(t\,1))" 8
gen "$V/Library/Bass/bass_stem.wav" "0.6*sin(2*PI*(55+27.5*gte(mod(t\,4)\,2))*t)*exp(-3*mod(t\,0.5))" 8
gen "$V/Library/Keys & Pads/keys_stem.wav" "0.2*(sin(2*PI*220*t)+sin(2*PI*277.18*t)+sin(2*PI*329.63*t))*exp(-1.5*mod(t\,2))" 8
gen "$V/Library/Keys & Pads/pad_stem.wav" "0.18*(sin(2*PI*110*t)+sin(2*PI*164.81*t)+sin(2*PI*220.5*t))*(0.6+0.4*sin(2*PI*0.25*t))" 8
gen "$V/Library/Guitars/guitar_stem.wav" "0.3*(2*mod(t*196\,1)-1)*exp(-5*mod(t\,0.25))" 8
gen "$V/Library/Vocals/lead_vox_main_comp_tuned_and_edited_v3.wav" "0.3*sin(2*PI*(440+6*sin(2*PI*5*t))*t)*(0.5+0.5*sin(2*PI*0.5*t))" 8
gen "$V/Loose/extra.wav" "0.3*sin(2*PI*660*t)*exp(-6*mod(t\,1))" 4
cd "$V" && find . -name "*.wav" -exec ls -la {} \; | awk '{print $5, $9, $10, $11, $12}'
df -h "$V" | tail -1 | awk '{print "free:", $4}'
