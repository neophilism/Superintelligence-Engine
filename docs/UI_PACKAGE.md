# SIE-008 Shared UI package

A single versioned React package `@superintelligence/ui` exposes semantic workspace panels and domain control metadata. Domain tools emit stable `data-help-anchor` tokens in both editions; **only Academy** can render attached courseware externally. Command Center renders the same workspace with `product="command"`, narrower spacing and corners. No duplicated tool logic or synthetic AI responses. 

Inspect `examples/shared-music.mjs` for the same Music interface in both modes; run `npm test` to verify the labels, anchors, and modes. Load `@superintelligence/ui/styles.css` in each application.

This work does not implement music generation or an actual Academy/Command Center application. Tool adapters and cross-app integration follow their roadmap dependencies.
