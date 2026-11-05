-- Fictional reading-room data; PostgreSQL syntax.
CREATE TABLE loans (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    book_title TEXT NOT NULL,
    category TEXT NOT NULL,
    borrowed_at DATE NOT NULL,
    returned_at DATE
);

INSERT INTO loans (book_title, category, borrowed_at, returned_at)
VALUES
    ('沿河散步', '随笔', '2026-10-02', '2026-10-16'),
    ('纸上的天气', '艺术', '2026-10-07', NULL),
    ('山间观察', '自然', '2026-10-11', '2026-10-25');

WITH monthly AS (
    SELECT category, COUNT(*) AS total_loans,
        COUNT(*) FILTER (WHERE returned_at IS NULL) AS still_reading
    FROM loans
    WHERE borrowed_at >= DATE '2026-10-01'
      AND borrowed_at < DATE '2026-11-01'
    GROUP BY category
)
SELECT category, total_loans, still_reading
FROM monthly
ORDER BY total_loans DESC, category;
