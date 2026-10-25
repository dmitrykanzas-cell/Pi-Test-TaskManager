using TaskManager.Domain;

namespace TaskManager.Storage;

public interface ITaskRepository
{
    IReadOnlyList<TaskItem> Load();
    void Save(IEnumerable<TaskItem> tasks);
}

public sealed class JsonTaskRepository : ITaskRepository
{
    private readonly string filePath;

    public JsonTaskRepository(string filePath)
    {
        if (string.IsNullOrWhiteSpace(filePath))
        {
            throw new ArgumentException("Storage path cannot be empty.", nameof(filePath));
        }

        this.filePath = Path.GetFullPath(filePath);
    }

    public IReadOnlyList<TaskItem> Load()
    {
        if (!File.Exists(filePath))
        {
            return [];
        }

        var json = File.ReadAllText(filePath);
        if (string.IsNullOrWhiteSpace(json))
        {
            return [];
        }

        var records = System.Text.Json.JsonSerializer.Deserialize<List<TaskRecord>>(json)
            ?? throw new InvalidDataException("Task storage contains no valid task list.");

        return records.Select(ToTask).ToList();
    }

    public void Save(IEnumerable<TaskItem> tasks)
    {
        var directory = Path.GetDirectoryName(filePath);
        if (directory is not null)
        {
            Directory.CreateDirectory(directory);
        }

        var records = tasks.Select(task => new TaskRecord(
            task.Title,
            task.Status,
            task.Priority)).ToList();

        var json = System.Text.Json.JsonSerializer.Serialize(records, new System.Text.Json.JsonSerializerOptions
        {
            WriteIndented = true
        });
        File.WriteAllText(filePath, json);
    }

    private static TaskItem ToTask(TaskRecord record)
    {
        var task = new TaskItem(record.Title);
        task.ChangePriority(record.Priority);
        if (record.Status == TaskItemStatus.InProgress)
        {
            task.ChangeStatus(TaskItemStatus.InProgress);
        }
        else if (record.Status == TaskItemStatus.Done)
        {
            task.ChangeStatus(TaskItemStatus.InProgress);
            task.ChangeStatus(TaskItemStatus.Done);
        }

        return task;
    }

    private sealed record TaskRecord(string Title, TaskItemStatus Status, TaskPriority Priority);
}
