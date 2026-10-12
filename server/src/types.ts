export type Structure = 'modules' | 'flat';

export interface CourseRow {
  id: string;
  title: string;
  root_path: string;
  structure: Structure;
  archived: number;
  sort_index: number | null;
  poster_lesson_id: string | null;
  cover_path: string | null;
  created_at: string;
  updated_at: string;
  last_scanned_at: string | null;
  source?: 'local' | 'drive';
  drive_folder_id?: string | null;
  drive_resource_key?: string | null;
}

export interface LessonRow {
  id: string;
  course_id: string;
  rel_path: string;
  module: string | null;
  title: string;
  order_index: number;
  module_order: number;
  duration_sec: number | null;
  size_bytes: number;
  mtime: number;
  container: string;
  playable: number;
  thumb_path: string | null;
  missing: number;
  remote_id?: string | null;
}

export interface MaterialRow {
  id: string;
  course_id: string;
  module: string | null;
  rel_path: string;
  kind: string;
  size_bytes: number;
  remote_id?: string | null;
}

export interface ProgressRow {
  lesson_id: string;
  position_sec: number;
  furthest_sec: number;
  duration_sec: number | null;
  completed: number;
  completed_at: string | null;
  auto_completed: number;
  updated_at: string;
}
