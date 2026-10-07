import com.sun.source.util.JavacTask;
import java.io.File;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;
import javax.tools.Diagnostic;
import javax.tools.DiagnosticCollector;
import javax.tools.JavaCompiler;
import javax.tools.JavaFileObject;
import javax.tools.StandardJavaFileManager;
import javax.tools.ToolProvider;

/** Parses Java files (syntax only: no classpath needed) and prints every syntax error. Usage: java JavaSyntax.java listfile */
public class JavaSyntax {
    public static void main(String[] args) throws Exception {
        List<String> paths = Files.readAllLines(new File(args[0]).toPath());
        JavaCompiler compiler = ToolProvider.getSystemJavaCompiler();
        DiagnosticCollector<JavaFileObject> diags = new DiagnosticCollector<>();
        StandardJavaFileManager fm = compiler.getStandardFileManager(diags, null, null);
        List<File> files = new ArrayList<>();
        for (String p : paths) if (!p.isBlank()) files.add(new File(p));
        JavacTask task = (JavacTask) compiler.getTask(null, fm, diags, List.of("-proc:none"), null, fm.getJavaFileObjectsFromFiles(files));
        task.parse();
        int errors = 0;
        for (Diagnostic<? extends JavaFileObject> d : diags.getDiagnostics()) {
            if (d.getKind() == Diagnostic.Kind.ERROR) {
                errors++;
                System.out.println(d.getSource().getName() + ":" + d.getLineNumber() + ": " + d.getMessage(null));
            }
        }
        System.out.println(errors == 0 ? "OK " + files.size() : "FAILED " + errors);
        System.exit(errors == 0 ? 0 : 1);
    }
}
