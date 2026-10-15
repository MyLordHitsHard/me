'use strict';
// Entity registry: the single source of truth for every user-owned table.
// Each field: { type, required?, enum?, min?, max?, maxLen?, ref?, heavy?, default? }
//   type: text | int | real | date | bool | enum | ref
//   heavy: excluded from list/bootstrap responses (fetched per-record)

const ENTITIES = {
  career: {
    label: 'Career item',
    fields: {
      title: { type: 'text', required: true, maxLen: 200 },
      kind: { type: 'enum', enum: ['education', 'job', 'internship', 'project', 'certificate', 'achievement', 'application', 'publication', 'other'], default: 'project' },
      org: { type: 'text', maxLen: 200 },
      location: { type: 'text', maxLen: 200 },
      start_date: { type: 'date' },
      end_date: { type: 'date' },
      status: { type: 'enum', enum: ['planned', 'active', 'done', 'applied', 'interview', 'offer', 'rejected'], default: 'done' },
      score: { type: 'text', maxLen: 100 },
      url: { type: 'text', maxLen: 500 },
      details: { type: 'text', maxLen: 20000 },
    },
  },
  skills: {
    label: 'Skill',
    fields: {
      name: { type: 'text', required: true, maxLen: 100 },
      category: { type: 'text', maxLen: 100 },
      level: { type: 'int', min: 0, max: 100, default: 0 },
      target: { type: 'int', min: 0, max: 100, default: 80 },
      notes: { type: 'text', maxLen: 20000 },
    },
  },
  skill_logs: {
    label: 'Practice log',
    fields: {
      skill_id: { type: 'ref', ref: 'skills', required: true },
      date: { type: 'date', required: true },
      minutes: { type: 'int', min: 0, max: 1440, default: 0 },
      level: { type: 'int', min: 0, max: 100 },
      note: { type: 'text', maxLen: 2000 },
    },
  },
  goals: {
    label: 'Goal',
    fields: {
      title: { type: 'text', required: true, maxLen: 200 },
      area: { type: 'enum', enum: ['career', 'learning', 'health', 'mind', 'relationships', 'finance', 'personal'], default: 'career' },
      status: { type: 'enum', enum: ['todo', 'doing', 'done', 'dropped'], default: 'todo' },
      progress: { type: 'int', min: 0, max: 100, default: 0 },
      due_date: { type: 'date' },
      notes: { type: 'text', maxLen: 20000 },
    },
  },
  exams: {
    label: 'Exam',
    fields: {
      name: { type: 'text', required: true, maxLen: 200 },
      subject: { type: 'text', maxLen: 200 },
      exam_date: { type: 'date' },
      status: { type: 'enum', enum: ['planned', 'preparing', 'done'], default: 'planned' },
      target_score: { type: 'real' },
      score: { type: 'real' },
      max_score: { type: 'real', default: 100 },
      prep_goal_hours: { type: 'real', min: 0, default: 40 },
      syllabus: { type: 'text', maxLen: 20000 },
      notes: { type: 'text', maxLen: 20000 },
    },
  },
  study_sessions: {
    label: 'Study session',
    fields: {
      exam_id: { type: 'ref', ref: 'exams', required: true },
      date: { type: 'date', required: true },
      minutes: { type: 'int', min: 0, max: 1440, default: 0 },
      topic: { type: 'text', maxLen: 300 },
      focus: { type: 'int', min: 1, max: 5 },
    },
  },
  workouts: {
    label: 'Workout',
    fields: {
      date: { type: 'date', required: true },
      type: { type: 'enum', enum: ['strength', 'cardio', 'sport', 'yoga', 'walk', 'hiit', 'other'], default: 'strength' },
      title: { type: 'text', maxLen: 200 },
      duration: { type: 'int', min: 0, max: 1440, default: 0 },
      calories: { type: 'int', min: 0, max: 20000 },
      intensity: { type: 'int', min: 1, max: 5, default: 3 },
      notes: { type: 'text', maxLen: 5000 },
    },
  },
  workout_sets: {
    label: 'Exercise',
    fields: {
      workout_id: { type: 'ref', ref: 'workouts', required: true },
      exercise: { type: 'text', required: true, maxLen: 100 },
      sets: { type: 'int', min: 0, max: 100 },
      reps: { type: 'int', min: 0, max: 1000 },
      weight: { type: 'real', min: 0, max: 2000 },
    },
  },
  notes: {
    label: 'Note',
    fields: {
      title: { type: 'text', required: true, maxLen: 200 },
      body: { type: 'text', maxLen: 200000 },
      tags: { type: 'text', maxLen: 500 },
      pinned: { type: 'bool', default: 0 },
    },
  },
  sketches: {
    label: 'Sketch',
    fields: {
      title: { type: 'text', required: true, maxLen: 200 },
      data: { type: 'text', maxLen: 4000000, heavy: true },
      thumb: { type: 'text', maxLen: 150000 },
    },
  },
  people: {
    label: 'Person',
    fields: {
      name: { type: 'text', required: true, maxLen: 200 },
      relation: { type: 'enum', enum: ['family', 'friend', 'mentor', 'colleague', 'classmate', 'acquaintance', 'other'], default: 'friend' },
      company: { type: 'text', maxLen: 200 },
      role: { type: 'text', maxLen: 200 },
      email: { type: 'text', maxLen: 200 },
      phone: { type: 'text', maxLen: 50 },
      birthday: { type: 'date' },
      location: { type: 'text', maxLen: 200 },
      how_met: { type: 'text', maxLen: 500 },
      closeness: { type: 'int', min: 1, max: 5, default: 3 },
      contact_every: { type: 'int', min: 1, max: 3650, default: 30 },
      last_contact: { type: 'date' },
      tags: { type: 'text', maxLen: 500 },
      notes: { type: 'text', maxLen: 20000 },
    },
  },
  interactions: {
    label: 'Interaction',
    fields: {
      person_id: { type: 'ref', ref: 'people', required: true },
      date: { type: 'date', required: true },
      kind: { type: 'enum', enum: ['call', 'meet', 'message', 'email', 'other'], default: 'message' },
      note: { type: 'text', maxLen: 5000 },
    },
  },
  checkins: {
    label: 'Daily check-in',
    fields: {
      date: { type: 'date', required: true },
      mood: { type: 'int', min: 1, max: 5 },
      energy: { type: 'int', min: 1, max: 5 },
      sleep: { type: 'real', min: 0, max: 24 },
      focus: { type: 'int', min: 1, max: 5 },
      stress: { type: 'int', min: 1, max: 5 },
      gratitude: { type: 'text', maxLen: 2000 },
      notes: { type: 'text', maxLen: 5000 },
    },
  },
  transactions: {
    label: 'Transaction',
    fields: {
      date: { type: 'date', required: true },
      kind: { type: 'enum', enum: ['income', 'expense', 'saving'], default: 'expense' },
      amount: { type: 'real', min: 0, required: true },
      category: { type: 'text', maxLen: 100 },
      note: { type: 'text', maxLen: 1000 },
    },
  },
  trackers: {
    label: 'Custom tracker',
    fields: {
      name: { type: 'text', required: true, maxLen: 100 },
      unit: { type: 'text', maxLen: 30 },
      daily_goal: { type: 'real', min: 0 },
      area: { type: 'enum', enum: ['career', 'learning', 'health', 'mind', 'relationships', 'finance', 'personal'], default: 'personal' },
    },
  },
  tracker_logs: {
    label: 'Tracker entry',
    fields: {
      tracker_id: { type: 'ref', ref: 'trackers', required: true },
      date: { type: 'date', required: true },
      value: { type: 'real', required: true },
      note: { type: 'text', maxLen: 1000 },
    },
  },
  swot_items: {
    label: 'SWOT item',
    fields: {
      quadrant: { type: 'enum', enum: ['S', 'W', 'O', 'T'], required: true },
      text: { type: 'text', required: true, maxLen: 1000 },
    },
  },
};

// Types that can be connected to each other through the generic `links` table.
const LINKABLE = ['career', 'skills', 'goals', 'exams', 'workouts', 'notes', 'sketches', 'people', 'trackers'];

// Parents must be imported before children.
const IMPORT_ORDER = Object.keys(ENTITIES).sort((a, b) => {
  const hasRef = (e) => Object.values(ENTITIES[e].fields).some((f) => f.type === 'ref');
  return hasRef(a) - hasRef(b);
});

module.exports = { ENTITIES, LINKABLE, IMPORT_ORDER };
