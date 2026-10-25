using TaskManager.Domain;
using TaskManager.Storage;

var storagePath = Path.Combine(AppContext.BaseDirectory, "tasks.json");
var repository = new JsonTaskRepository(storagePath);
var tasks = repository.Load().ToList();

Console.WriteLine("TaskManager");
Console.WriteLine("Команды: add <заголовок>, list, search <текст>, done <номер>, quit");

while (true)
{
    Console.Write("> ");
    var input = Console.ReadLine();
    if (input is null || input.Equals("quit", StringComparison.OrdinalIgnoreCase))
    {
        break;
    }

    if (input.Equals("list", StringComparison.OrdinalIgnoreCase))
    {
        for (var i = 0; i < tasks.Count; i++)
        {
            var task = tasks[i];
            Console.WriteLine($"{i + 1}. [{task.Status}] [{task.Priority}] {task.Title}");
        }

        continue;
    }

    if (input.StartsWith("search ", StringComparison.OrdinalIgnoreCase))
    {
        var matches = TaskQuery.Filter(tasks, input[7..].Trim()).ToList();
        foreach (var task in matches)
        {
            Console.WriteLine($"[{task.Status}] [{task.Priority}] {task.Title}");
        }

        if (matches.Count == 0)
        {
            Console.WriteLine("Задачи не найдены.");
        }

        continue;
    }

    if (input.StartsWith("add ", StringComparison.OrdinalIgnoreCase))
    {
        try
        {
            tasks.Add(new TaskItem(input[4..]));
            repository.Save(tasks);
            Console.WriteLine("Задача добавлена.");
        }
        catch (ArgumentException exception)
        {
            Console.WriteLine($"Ошибка: {exception.Message}");
        }

        continue;
    }

    if (input.StartsWith("done ", StringComparison.OrdinalIgnoreCase)
        && int.TryParse(input[5..], out var number)
        && number > 0
        && number <= tasks.Count)
    {
        var task = tasks[number - 1];
        try
        {
            task.ChangeStatus(TaskItemStatus.InProgress);
            task.ChangeStatus(TaskItemStatus.Done);
            repository.Save(tasks);
            Console.WriteLine("Задача завершена.");
        }
        catch (InvalidOperationException exception)
        {
            Console.WriteLine($"Ошибка: {exception.Message}");
        }

        continue;
    }

    Console.WriteLine("Неизвестная команда.");
}

Console.WriteLine("Завершение.");

public static class TaskManagerEntryPoint;
