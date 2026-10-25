namespace TaskManager.Domain;

public sealed class TaskItem
{
    public TaskItem(string title)
    {
        if (string.IsNullOrWhiteSpace(title))
        {
            throw new ArgumentException("Task title cannot be empty.", nameof(title));
        }

        Title = title.Trim();
    }

    public string Title { get; }

    public TaskItemStatus Status { get; private set; }

    public TaskPriority Priority { get; private set; } = TaskPriority.Normal;

    public void ChangePriority(TaskPriority priority)
    {
        Priority = priority;
    }

    public void ChangeStatus(TaskItemStatus status)
    {
        if (Status == TaskItemStatus.Done && status != TaskItemStatus.Done)
        {
            throw new InvalidOperationException("A completed task cannot return to an earlier status.");
        }

        if (Status == TaskItemStatus.New && status == TaskItemStatus.Done)
        {
            throw new InvalidOperationException("A new task must be started before it can be completed.");
        }

        Status = status;
    }
}
