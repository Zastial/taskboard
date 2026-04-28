jest.mock('../../src/db');

const request = require('supertest');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const app = require('../../src/app');
const pool = require('../../src/db');

const generateToken = (payload = { id: 1, username: 'admin' }) => {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /health', () => {
  test('should return 200 when database is connected', async () => {
    pool.query.mockResolvedValue({ rows: [{ '?column?': 1 }] });

    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body).toHaveProperty('timestamp');
  });

  test('should return 503 when database is unreachable', async () => {
    pool.query.mockRejectedValue(new Error('Connection refused'));

    const res = await request(app).get('/health');

    expect(res.status).toBe(503);
    expect(res.body.status).toBe('error');
  });
});

describe('POST /auth/login', () => {
  test('should return a JWT token for valid credentials', async () => {
    const hashedPassword = await bcrypt.hash('admin123', 10);
    pool.query.mockResolvedValue({
      rows: [{ id: 1, username: 'admin', password: hashedPassword }],
    });

    const res = await request(app)
      .post('/auth/login')
      .send({ username: 'admin', password: 'admin123' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
    expect(res.body.user.username).toBe('admin');
  });

  test('should return 401 for unknown user', async () => {
    pool.query.mockResolvedValue({ rows: [] });

    const res = await request(app)
      .post('/auth/login')
      .send({ username: 'unknown', password: 'password' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid credentials');
  });

  test('should return 400 when username or password is missing', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ username: 'admin' });

    expect(res.status).toBe(400);
  });
});

describe('GET /tasks', () => {
  test('should return 401 without authentication', async () => {
    const res = await request(app).get('/tasks');

    expect(res.status).toBe(401);
  });

  test('should return tasks with valid token', async () => {
    const mockTasks = [
      { id: 1, title: 'Task 1', status: 'todo' },
      { id: 2, title: 'Task 2', status: 'done' },
    ];
    pool.query.mockResolvedValue({ rows: mockTasks });

    const token = generateToken();
    const res = await request(app)
      .get('/tasks')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].title).toBe('Task 1');
  });
});

describe('POST /tasks', () => {
  test('should create a task and return 201', async () => {
    const newTask = { title: 'New Task', description: 'Description' };
    const mockResult = { id: 1, ...newTask, status: 'todo', created_at: '2024-01-01' };
    pool.query.mockResolvedValue({ rows: [mockResult] });

    const token = generateToken();
    const res = await request(app)
      .post('/tasks')
      .set('Authorization', `Bearer ${token}`)
      .send(newTask);

    expect(res.status).toBe(201);
    expect(res.body.title).toBe('New Task');
    expect(res.body.status).toBe('todo');
  });

  test('should return 500 when creation fails', async () => {
    pool.query.mockRejectedValue(new Error('Database error'));

    const token = generateToken();
    const res = await request(app)
      .post('/tasks')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Task', description: 'Desc' });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Internal server error');
  });
});

describe('GET /tasks with status filter', () => {
  test('should filter tasks by status when query parameter provided', async () => {
    const mockTasks = [
      { id: 1, title: 'Task 1', status: 'done' },
    ];
    pool.query.mockResolvedValue({ rows: mockTasks });

    const token = generateToken();
    const res = await request(app)
      .get('/tasks?status=done')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].status).toBe('done');
  });
});

describe('PUT /tasks/:id', () => {
  test('should update a task and return 200', async () => {
    const updatedTask = { id: 1, title: 'Updated Task', status: 'done', description: 'Updated' };
    pool.query.mockResolvedValue({ rows: [updatedTask] });

    const token = generateToken();
    const res = await request(app)
      .put('/tasks/1')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Updated Task', status: 'done' });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Updated Task');
    expect(res.body.status).toBe('done');
  });

  test('should return 404 when task not found', async () => {
    pool.query.mockResolvedValue({ rows: [] });

    const token = generateToken();
    const res = await request(app)
      .put('/tasks/999')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Updated' });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Task not found');
  });
});

describe('DELETE /tasks/:id', () => {
  test('should delete a task and return success message', async () => {
    const deletedTask = { id: 1, title: 'Task to delete' };
    pool.query.mockResolvedValue({ rows: [deletedTask] });

    const token = generateToken();
    const res = await request(app)
      .delete('/tasks/1')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Task deleted successfully');
  });

  test('should return 404 when deleting non-existent task', async () => {
    pool.query.mockResolvedValue({ rows: [] });

    const token = generateToken();
    const res = await request(app)
      .delete('/tasks/999')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Task not found');
  });
});

describe('GET /metrics', () => {
  test('should return 501 for unimplemented metrics endpoint', async () => {
    const res = await request(app).get('/metrics');

    expect(res.status).toBe(501);
    expect(res.body.message).toBe('Metrics endpoint not yet implemented');
  });
});
