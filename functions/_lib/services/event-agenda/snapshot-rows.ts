import { batchFirst, batchRows } from "../../db/pagination";
import type { D1StatementResult, DatabaseLike } from "../../types";
import { eventReadIdSql, type EventReadSelection } from "../events/selection";
import { personDisplayNameSql } from "../people/person-name-sql";

/** Independent editor projections share one D1 transaction and network round trip. */
export function prepareAgendaSnapshotRows(db: DatabaseLike, eventId: EventReadSelection) {
  const scope = eventReadIdSql(eventId);
  return [
    db
      .prepare(
        `SELECT settings_json,timezone,starts_at,ends_at,name,base_path,city,visibility FROM events WHERE id = ${scope.sql}`,
      )
      .bind(...scope.bindings),
    db
      .prepare(
        `SELECT revision,published_revision,travel_minutes FROM event_agenda_state WHERE event_id = ${scope.sql}`,
      )
      .bind(...scope.bindings),
    db
      .prepare(
        `SELECT id,name,capacity,setup_minutes,equipment_json,available_periods_json,virtual_room_url FROM event_agenda_rooms WHERE event_id = ${scope.sql} ORDER BY name,id LIMIT 200`,
      )
      .bind(...scope.bindings),
    db
      .prepare(
        `SELECT id,name,start_at,end_at,room_id,track,roles_json,role_requirements_json,compatible_roles_json,boundaries_json FROM event_agenda_shifts WHERE event_id = ${scope.sql} ORDER BY start_at,id LIMIT 200`,
      )
      .bind(...scope.bindings),
    db
      .prepare(
        `SELECT member.user_id,${personDisplayNameSql("user", "Staff")} AS display_name,member.roles_json,member.available_from,member.available_until,member.max_minutes,member.seniority,member.attendance_mode FROM event_agenda_role_members member JOIN users user ON user.id=member.user_id WHERE member.event_id = ${scope.sql} LIMIT 200`,
      )
      .bind(...scope.bindings),
    db
      .prepare(
        `SELECT id,name,show_on_agenda FROM event_agenda_staffing_roles WHERE event_id=${scope.sql} ORDER BY id LIMIT 100`,
      )
      .bind(...scope.bindings),
    db
      .prepare(
        `SELECT id,name,room_id AS roomId FROM event_agenda_staffing_posts WHERE event_id=${scope.sql} ORDER BY id LIMIT 200`,
      )
      .bind(...scope.bindings),
    db
      .prepare(
        `SELECT id,shift_id AS shiftId,role_id AS roleId,post_id AS postId,ideal_count AS idealCount,seniority,attendance_mode AS attendanceMode FROM event_agenda_staffing_requirements WHERE event_id=${scope.sql} ORDER BY id LIMIT 1000`,
      )
      .bind(...scope.bindings),
    db
      .prepare(
        `SELECT id,requirement_id AS requirementId,position_index AS [index] FROM event_agenda_staffing_positions WHERE event_id=${scope.sql} ORDER BY requirement_id,position_index LIMIT 2000`,
      )
      .bind(...scope.bindings),
    db
      .prepare(
        `SELECT assignment.position_id,assignment.post_id,assignment.shift_id,assignment.role,assignment.user_id,assignment.pinned,assignment.origin FROM event_agenda_assignments assignment JOIN event_agenda_shifts shift ON shift.id=assignment.shift_id WHERE shift.event_id = ${scope.sql} ORDER BY assignment.position_id LIMIT 2000`,
      )
      .bind(...scope.bindings),
  ];
}

export function decodeAgendaSnapshotRows(results: D1StatementResult[]) {
  return {
    event: batchFirst<{
      settings_json: string;
      timezone: string;
      starts_at: string | null;
      ends_at: string | null;
      name: string;
      base_path: string | null;
      city: string | null;
      visibility: string;
    }>(results[0]),
    state: batchFirst<{ revision: number; published_revision: number | null; travel_minutes: number }>(results[1]),
    rooms: batchRows<{
      id: string;
      name: string;
      capacity: number | null;
      setup_minutes: number;
      equipment_json: string;
      available_periods_json: string;
      virtual_room_url: string | null;
    }>(results[2]),
    shifts: batchRows<{
      id: string;
      name: string;
      start_at: string;
      end_at: string;
      room_id: string | null;
      track: string | null;
      roles_json: string;
      role_requirements_json: string;
      compatible_roles_json: string;
      boundaries_json: string;
    }>(results[3]),
    members: batchRows<{
      user_id: string;
      display_name: string;
      roles_json: string;
      available_from: string | null;
      available_until: string | null;
      max_minutes: number | null;
      seniority: string;
      attendance_mode: string;
    }>(results[4]),
    staffingRoles: batchRows<{ id: string; name: string; show_on_agenda: number }>(results[5]),
    staffingPosts: batchRows<{ id: string; name: string; roomId: string | null }>(results[6]),
    staffingRequirements: batchRows<{
      id: string;
      shiftId: string;
      roleId: string;
      postId: string | null;
      idealCount: number;
      seniority: string;
      attendanceMode: string;
    }>(results[7]),
    staffingPositions: batchRows<{ id: string; requirementId: string; index: number }>(results[8]),
    assignments: batchRows<{
      position_id: string;
      post_id: string | null;
      shift_id: string;
      role: string;
      user_id: string;
      pinned: number;
      origin: "manual" | "generated";
    }>(results[9]),
  };
}
