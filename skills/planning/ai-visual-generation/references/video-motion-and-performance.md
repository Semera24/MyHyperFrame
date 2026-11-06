# Video motion and performance

## Start from the input state

For image-to-video, describe what happens next from the pictured state: movement, interaction, and how the action ends. Add environmental motion where relevant. If the intended action conflicts with the image, consider correcting the image first.

## Organize the prompt

Use this order, including only the parts the shot needs:

1. Shot size and camera position: framing and viewing angle.
2. Subject and action: who does what and how it develops.
3. Setting: environment and important spatial relationships.
4. Camera movement: how the camera moves and what it reveals.
5. Visual treatment: focal length, depth of field, lighting, materials, grade, or film texture where relevant.
6. Sound and timing: dialogue, music, SFX, and their corresponding actions or time spans where needed.

Keep details already expressed by inputs brief. Do not mechanically fill every section. Set aspect ratio through the tool parameter. Follow the selected model's tool instructions for special formatting; XML is not required by this structure.

## Make performance visible

Express emotion through gaze, expression, breathing, posture, speed, or pauses. For example: she hears a sound behind her, stops what she is doing, shifts her eyes, then slowly turns her head. Evaluative adjectives alone do not direct an action.

For grabbing, collisions, jumps, turns, or interactions, describe relevant starting positions, movement direction, action order, contact, reactions, and ending poses. Use pose images, motion video, or keyframes for complex actions.

## Direct the camera

Describe movement relative to the subject and the resulting view. For example: the camera moves right from behind her shoulder, gradually revealing the envelope in her hand, and ends with both the envelope and her profile visible.

Distinguish camera movement from subject movement and explain their relationship when both move. Keep camera instructions compatible; if different moves occur in sequence, state when they change.

## Choose controls

For precise performance, trajectory, or camera movement, check for motion-reference, video-editing, or keyframe capabilities. Specify which aspects of a reference video to follow.

When an exact opening or ending matters, create the corresponding keyframes. When supplying both, describe how the pose and state change between them. If an action cannot be reliably completed in one generation, split at meaningful states that can connect.

## Inspect and revise

Play the video to inspect the action and important changes. Still frames help locate defects but do not replace watching movement. Check the requirements of this shot: completion of the action, plausible contact, identity, or the camera's intended destination.

Turn observed defects into specific corrections. Keep constraints that remain relevant and remove stale or contradictory wording rather than accumulating a growing list of every past problem. Adjust instructions, references, or the generation method to address the actual deviation.
