import { Tabs, TabsContent, TabsList, TabsTrigger } from '@radix-ui/react-tabs';
import { Mail, FileText, FolderOpen, Wrench } from 'lucide-react';
import { useUIStore } from '../../store';
import { cn } from '../../lib/utils';

export function ViewerPane() {
  const { viewerTab, setViewerTab } = useUIStore();

  return (
    <div className="flex flex-col h-full w-full overflow-hidden bg-background">
      {/* Tabs */}
      <Tabs value={viewerTab} onValueChange={(v) => setViewerTab(v as typeof viewerTab)} className="flex flex-col flex-1 min-h-0">
        <TabsList className="flex items-center gap-1 p-2 border-b border-border">
          <TabsTrigger
            value="gmail"
            className={cn(
              'flex items-center gap-2 px-3 py-2 rounded-lg',
              viewerTab === 'gmail' ? 'bg-muted' : 'hover:bg-muted/50'
            )}
          >
            <Mail className="w-4 h-4" />
            <span>Gmail</span>
          </TabsTrigger>
          <TabsTrigger
            value="docs"
            className={cn(
              'flex items-center gap-2 px-3 py-2 rounded-lg',
              viewerTab === 'docs' ? 'bg-muted' : 'hover:bg-muted/50'
            )}
          >
            <FileText className="w-4 h-4" />
            <span>Docs</span>
          </TabsTrigger>
          <TabsTrigger
            value="files"
            className={cn(
              'flex items-center gap-2 px-3 py-2 rounded-lg',
              viewerTab === 'files' ? 'bg-muted' : 'hover:bg-muted/50'
            )}
          >
            <FolderOpen className="w-4 h-4" />
            <span>Files</span>
          </TabsTrigger>
          <TabsTrigger
            value="mcp"
            className={cn(
              'flex items-center gap-2 px-3 py-2 rounded-lg',
              viewerTab === 'mcp' ? 'bg-muted' : 'hover:bg-muted/50'
            )}
          >
            <Wrench className="w-4 h-4" />
            <span>MCP</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="gmail" className="flex-1 min-h-0 overflow-y-auto p-4">
          <GmailView />
        </TabsContent>

        <TabsContent value="docs" className="flex-1 min-h-0 overflow-y-auto p-4">
          <DocsView />
        </TabsContent>

        <TabsContent value="files" className="flex-1 min-h-0 overflow-y-auto p-4">
          <FilesView />
        </TabsContent>

        <TabsContent value="mcp" className="flex-1 min-h-0 overflow-y-auto p-4">
          <MCPView />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function GmailView() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
      <Mail className="w-12 h-12 mb-4" />
      <h3 className="text-lg font-semibold mb-2">Gmail Integration</h3>
      <p className="text-sm text-center max-w-md">
        Connect your Gmail account to view and manage emails directly in the viewer.
        OAuth2 authentication required.
      </p>
      <button className="mt-4 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90">
        Connect Gmail
      </button>
    </div>
  );
}

function DocsView() {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">Documents</h3>
        <button className="px-3 py-1 bg-muted rounded-lg hover:bg-muted/80">
          New Doc
        </button>
      </div>
      <div className="flex-1 border border-border rounded-lg p-4">
        <div className="prose prose-invert max-w-none">
          <p className="text-muted-foreground">
            Select a document to view or create a new one.
          </p>
        </div>
      </div>
    </div>
  );
}

function FilesView() {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">Files</h3>
        <button className="px-3 py-1 bg-muted rounded-lg hover:bg-muted/80">
          Upload
        </button>
      </div>
      <div className="flex-1 border border-border rounded-lg p-4">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {/* Placeholder file items */}
          {['memory', 'config', 'notes'].map((name) => (
            <div
              key={name}
              className="flex flex-col items-center p-4 border border-border rounded-lg hover:bg-muted cursor-pointer"
            >
              <FileText className="w-8 h-8 mb-2" />
              <span className="text-sm">{name}.md</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MCPView() {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">MCP Tools</h3>
        <button className="px-3 py-1 bg-muted rounded-lg hover:bg-muted/80">
          Add Server
        </button>
      </div>
      <div className="flex-1 border border-border rounded-lg p-4">
        <div className="space-y-4">
          {/* Placeholder MCP servers */}
          <div className="p-4 border border-border rounded-lg">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-semibold">filesystem</h4>
                <p className="text-sm text-muted-foreground">Local file system access</p>
              </div>
              <span className="px-2 py-1 bg-green-500/20 text-green-500 rounded text-xs">
                Connected
              </span>
            </div>
          </div>
          <div className="p-4 border border-border rounded-lg">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-semibold">github</h4>
                <p className="text-sm text-muted-foreground">GitHub API integration</p>
              </div>
              <span className="px-2 py-1 bg-yellow-500/20 text-yellow-500 rounded text-xs">
                Disconnected
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}