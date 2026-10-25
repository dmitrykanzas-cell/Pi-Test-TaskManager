namespace TaskManager.Domain;

public static class TaskQuery
{
    public static IEnumerable<TaskItem> Filter(
        IEnumerable<TaskItem> tasks,
        string? titleQuery = null,
        TaskItemStatus? status = null,
        TaskPriority? priority = null)
    {
        ArgumentNullException.ThrowIfNull(tasks);

        var query = tasks.AsEnumerable();
        if (!string.IsNullOrWhiteSpace(titleQuery))
        {
            query = query.Where(task => task.Title.Contains(titleQuery.Trim(), StringComparison.OrdinalIgnoreCase));
        }

        if (status.HasValue)
        {
            query = query.Where(task => task.Status == status.Value);
        }

        if (priority.HasValue)
        {
            query = query.Where(task => task.Priority == priority.Value);
        }

        return query;
    }
}
