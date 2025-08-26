import express from 'express';
import { knexInstance } from '../config/database.js';

const router = express.Router();

// List tables
router.get('/tables', async (req, res) => {
  try {
    const { rows } = await knexInstance.raw(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name;
    `);
    res.json({ success: true, tables: rows.map(r => r.table_name) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Full schema (tables -> columns)
router.get('/schema', async (req, res) => {
  try {
    const { rows } = await knexInstance.raw(`
      SELECT
        c.table_name,
        c.column_name,
        c.data_type,
        c.is_nullable,
        c.character_maximum_length,
        c.numeric_precision,
        c.numeric_scale
      FROM information_schema.columns c
      WHERE c.table_schema = 'public'
      ORDER BY c.table_name, c.ordinal_position;
    `);

    const schema = {};
    for (const r of rows) {
      if (!schema[r.table_name]) schema[r.table_name] = [];
      schema[r.table_name].push({
        column: r.column_name,
        type: r.data_type,
        nullable: r.is_nullable === 'YES',
        char_max: r.character_maximum_length,
        numeric_precision: r.numeric_precision,
        numeric_scale: r.numeric_scale,
      });
    }
    res.json({ success: true, schema });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Basic FK relations
router.get('/relations', async (req, res) => {
  try {
    const { rows } = await knexInstance.raw(`
      SELECT
        tc.table_name AS table_name,
        kcu.column_name AS column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
      WHERE constraint_type = 'FOREIGN KEY' AND tc.table_schema='public'
      ORDER BY tc.table_name, kcu.column_name;
    `);
    res.json({ success: true, relations: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Sample data from a table
router.get('/table/:name/sample', async (req, res) => {
  const table = req.params.name;
  const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
  try {
    const rows = await knexInstance(table).select('*').limit(limit);
    res.json({ success: true, table, count: rows.length, rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
