-- A room screen's scene is where it starts; a locked screen keeps that scene
-- whatever a take from Preview brings. Screens saved with a scene before this
-- always kept it, so they stay locked.
ALTER TABLE event_agenda_room_outputs ADD COLUMN scene_locked INTEGER NOT NULL DEFAULT 0;
UPDATE event_agenda_room_outputs SET scene_locked = 1 WHERE scene_slug IS NOT NULL;
