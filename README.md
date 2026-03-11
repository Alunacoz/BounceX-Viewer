# BounceX-Viewer

> **License:** MIT License + Commons Clause  
> ⚠️ **Note:** Don't commercialize it without permission!

An admittedly vibe-coded, self-hosted, private video viewer that syncs BounceX paths to corresponding videos with full customization options.

## AI Disclosure

This program was written with generative AI, with human intervention as well. I felt like it was important to be upfront with this information because I understand that it is not everyone's cup of tea.

## Features

- 🎯 Path Synchronization: Automatically syncs BounceX paths to their corresponding videos! Works when scrubbing as well!
- 🔒 Private & Self-Hosted: Completely private! Host any video you like on your own personal network!
- 🎭 Theater Mode: Unobstructed viewing experience for maximum immersion!
- 📺 Classic Overlays: Generated on the fly, with the ability to disable the background dim!
- 🔄 Y-Axis Flip: Need a different perspective? Flip the Y-axis with ease!
- 📍 Multiple Paths Per Video: Perfect for difficulty selection or different route options!
- 🎨 Color Customization: Make those paths your own with custom colors!
- 📏 Path Size Control: Adjust path thickness to your preference!
- 📦 Easy Imports: Just drag in a .zip file to add new videos!
- 📱 Cross-Device Access: Watch on any device (including mobile!) on your local network!
- 🚀 More to Come: Stay tuned for additional features and improvements!

## Getting Started

See [Installation](https://github.com/Alunacoz/BounceX-Viewer/wiki/Installation) to get started!

### Troubleshooting

If you run into any issues, try a hard refresh:

**Windows/Linux:** `Ctrl + Shift + R`  
**Mac:** `Cmd + Shift + R`

This resolves most caching issues that may occur. This also may erase some settings.

**Need more help?** Check the existing examples in the `/videos/` directory for reference implementations or ask me directly on Discord! You can find me in the [DH Discord Server](https://discord.gg/u6CZ3Zm4PC), and my DMs are open!


## Future Updates

There's a lot to be done! The top of the list are features that I'm closer to finishing, and the bottom means it's low priority/very difficult.
- Fix manager not being killed on Windows
- Remove reliance on meta.json (Use video title and automatically figure out its duration if missing! Delete duration field altogether?)
- In meta.json, allow a .bx file to have an offset.
- Customizable path speed
- Flesh out the manager, add "Create package..." button which streamlines package creation like YouTube uploads (need the above 2 first, so that those fields are included here)
- Update Wiki with information on making new packages
- In settings, create universal offset (to deal with delay in headphones? Need feedback on if this is actually necessary since every other site would have this problem too, no?)
- OSSM/Other Machine support (I don't have any, so it's kinda hard to work on... I'm looking into [Buttplug.io](https://buttplug.io/) specifically though)

## Credits

Thank you to [Optiacku](https://github.com/clbhundley/BounceX) in the [DH Discord Server](https://discord.gg/u6CZ3Zm4PC) for creating the original concept for BounceX! (This project was not endorsed or encouraged by Optiacku, I merely made a more convenient way to view the .bx files)
