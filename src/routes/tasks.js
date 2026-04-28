const express = require('express');
const router = express.Router();
const Task = require('../models/task');
const auth = require('../middleware/auth');

// Get all tasks (optionally filter by status)
router.get('/', auth, async (req, res) => {
  try {
    var tasks;
    const { status } = req.query;

    if (status) {
      tasks = await Task.findByStatus(status);
    } else {
      tasks = await Task.findAll();
    }

    console.log('Fetched ' + tasks.length + ' tasks');
    res.json(tasks);
  } catch (err) {
    console.error('Error fetching tasks:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create a task
router.post('/', auth, async (req, res) => {
  try {
    const { title, description, status } = req.body;

    const task = await Task.create({ title, description, status });
    console.log('Task created:', task.id);
    res.status(201).json(task);
  } catch (err) {
    console.error('Error creating task:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update a task
router.put('/:id', auth, async (req, res) => {
  try {
    const { title, description, status } = req.body;
    const task = await Task.update(req.params.id, { title, description, status });

    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    console.log('Task updated:', task.id);
    res.json(task);
  } catch (err) {
    console.error('Error updating task:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete a task
router.delete('/:id', auth, async (req, res) => {
  try {
    const deletedTask = await Task.delete(req.params.id);

    if (!deletedTask) {
      return res.status(404).json({ error: 'Task not found' });
    }

    console.log('Task deleted:', deletedTask.id);
    res.json({ message: 'Task deleted successfully' });
  } catch (err) {
    console.error('Error deleting task:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
