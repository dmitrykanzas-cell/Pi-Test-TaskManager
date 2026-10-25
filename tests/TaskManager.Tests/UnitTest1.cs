using TaskManager.Domain;
using TaskManager.Storage;

namespace TaskManager.Tests;

public sealed class TaskItemTests
{
    [Fact]
    public void NewTask_HasNewStatusAndNormalPriority()
    {
        var task = new TaskItem("Write specification");

        Assert.Equal(TaskItemStatus.New, task.Status);
        Assert.Equal(TaskPriority.Normal, task.Priority);
        Assert.Equal("Write specification", task.Title);
    }

    [Fact]
    public void EmptyTitle_IsRejected()
    {
        Assert.Throws<ArgumentException>(() => new TaskItem("  "));
    }

    [Fact]
    public void Status_CanMoveFromNewToInProgressToDone()
    {
        var task = new TaskItem("Implement domain model");

        task.ChangeStatus(TaskItemStatus.InProgress);
        task.ChangeStatus(TaskItemStatus.Done);

        Assert.Equal(TaskItemStatus.Done, task.Status);
    }

    [Fact]
    public void DoneTask_CannotReturnToInProgress()
    {
        var task = new TaskItem("Finish stage");
        task.ChangeStatus(TaskItemStatus.InProgress);
        task.ChangeStatus(TaskItemStatus.Done);

        Assert.Throws<InvalidOperationException>(() => task.ChangeStatus(TaskItemStatus.InProgress));
    }

    [Fact]
    public void Priority_CanBeChanged()
    {
        var task = new TaskItem("Review code");

        task.ChangePriority(TaskPriority.High);

        Assert.Equal(TaskPriority.High, task.Priority);
    }

    [Fact]
    public void JsonRepository_RoundTripsTask()
    {
        var path = Path.Combine(Path.GetTempPath(), $"task-manager-{Guid.NewGuid():N}.json");
        try
        {
            var task = new TaskItem("Persist task");
            task.ChangePriority(TaskPriority.High);
            task.ChangeStatus(TaskItemStatus.InProgress);

            var repository = new JsonTaskRepository(path);
            repository.Save([task]);
            var loaded = repository.Load();

            var result = Assert.Single(loaded);
            Assert.Equal(task.Title, result.Title);
            Assert.Equal(task.Status, result.Status);
            Assert.Equal(task.Priority, result.Priority);
        }
        finally
        {
            if (File.Exists(path))
            {
                File.Delete(path);
            }
        }
    }

    [Fact]
    public void JsonRepository_MissingFileReturnsEmptyList()
    {
        var path = Path.Combine(Path.GetTempPath(), $"missing-task-manager-{Guid.NewGuid():N}.json");

        var loaded = new JsonTaskRepository(path).Load();

        Assert.Empty(loaded);
    }

    [Fact]
    public void Query_FiltersByTitleStatusAndPriority_IgnoringCase()
    {
        var matching = new TaskItem("Review Pi plan");
        matching.ChangePriority(TaskPriority.High);
        matching.ChangeStatus(TaskItemStatus.InProgress);

        var other = new TaskItem("Write documentation");
        var tasks = new[] { matching, other };

        var result = TaskQuery.Filter(tasks, "pi", TaskItemStatus.InProgress, TaskPriority.High);

        Assert.Single(result);
        Assert.Same(matching, result.Single());
    }

    [Fact]
    public void Query_WithEmptyTitleAndNoFilters_ReturnsAllTasks()
    {
        var tasks = new[] { new TaskItem("First"), new TaskItem("Second") };

        var result = TaskQuery.Filter(tasks, " ");

        Assert.Equal(2, result.Count());
    }
}