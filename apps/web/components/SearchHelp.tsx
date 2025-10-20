'use client';

import { useState } from 'react';
import { HelpCircle, ChevronDown, ChevronUp, BookOpen, Lightbulb, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface HelpSection {
  id: string;
  title: string;
  icon: React.ReactNode;
  content: React.ReactNode;
}

export function SearchHelp() {
  const [expandedSection, setExpandedSection] = useState<string | null>(null);

  const toggleSection = (sectionId: string) => {
    setExpandedSection(expandedSection === sectionId ? null : sectionId);
  };

  const helpSections: HelpSection[] = [
    {
      id: 'operators',
      title: 'Boolean Operators',
      icon: <Zap className="h-4 w-4" />,
      content: (
        <div className="space-y-4">
          <div className="grid gap-3">
            <div className="flex items-start gap-3">
              <Badge variant="outline" className="font-mono">AND</Badge>
              <div>
                <p className="font-medium">Logical AND</p>
                <p className="text-sm text-muted-foreground">Both terms must be present</p>
                <code className="text-xs bg-muted px-2 py-1 rounded mt-1 block">
                  machine learning AND neural networks
                </code>
              </div>
            </div>
            
            <div className="flex items-start gap-3">
              <Badge variant="outline" className="font-mono">OR</Badge>
              <div>
                <p className="font-medium">Logical OR</p>
                <p className="text-sm text-muted-foreground">Either term can be present</p>
                <code className="text-xs bg-muted px-2 py-1 rounded mt-1 block">
                  deep learning OR machine learning
                </code>
              </div>
            </div>
            
            <div className="flex items-start gap-3">
              <Badge variant="outline" className="font-mono">NOT</Badge>
              <div>
                <p className="font-medium">Logical NOT</p>
                <p className="text-sm text-muted-foreground">Exclude terms</p>
                <code className="text-xs bg-muted px-2 py-1 rounded mt-1 block">
                  artificial intelligence NOT robotics
                </code>
              </div>
            </div>
            
            <div className="flex items-start gap-3">
              <Badge variant="outline" className="font-mono">NEAR</Badge>
              <div>
                <p className="font-medium">Proximity Search</p>
                <p className="text-sm text-muted-foreground">Terms within 10 words of each other</p>
                <code className="text-xs bg-muted px-2 py-1 rounded mt-1 block">
                  climate change NEAR adaptation
                </code>
              </div>
            </div>
          </div>
        </div>
      )
    },
    {
      id: 'fields',
      title: 'Field-Specific Search',
      icon: <BookOpen className="h-4 w-4" />,
      content: (
        <div className="space-y-4">
          <div className="grid gap-3">
            <div className="flex items-start gap-3">
              <Badge variant="outline" className="font-mono">title:</Badge>
              <div>
                <p className="font-medium">Title Search</p>
                <p className="text-sm text-muted-foreground">Search only in paper titles</p>
                <code className="text-xs bg-muted px-2 py-1 rounded mt-1 block">
                  title:"machine learning"
                </code>
              </div>
            </div>
            
            <div className="flex items-start gap-3">
              <Badge variant="outline" className="font-mono">authors:</Badge>
              <div>
                <p className="font-medium">Author Search</p>
                <p className="text-sm text-muted-foreground">Find papers by specific authors</p>
                <code className="text-xs bg-muted px-2 py-1 rounded mt-1 block">
                  authors:"Geoffrey Hinton"
                </code>
              </div>
            </div>
            
            <div className="flex items-start gap-3">
              <Badge variant="outline" className="font-mono">abstract:</Badge>
              <div>
                <p className="font-medium">Abstract Search</p>
                <p className="text-sm text-muted-foreground">Search in paper abstracts</p>
                <code className="text-xs bg-muted px-2 py-1 rounded mt-1 block">
                  abstract:"neural networks"
                </code>
              </div>
            </div>
            
            <div className="flex items-start gap-3">
              <Badge variant="outline" className="font-mono">venue:</Badge>
              <div>
                <p className="font-medium">Journal/Conference</p>
                <p className="text-sm text-muted-foreground">Search by publication venue</p>
                <code className="text-xs bg-muted px-2 py-1 rounded mt-1 block">
                  venue:"Nature"
                </code>
              </div>
            </div>
            
            <div className="flex items-start gap-3">
              <Badge variant="outline" className="font-mono">doi:</Badge>
              <div>
                <p className="font-medium">DOI Lookup</p>
                <p className="text-sm text-muted-foreground">Find specific paper by DOI</p>
                <code className="text-xs bg-muted px-2 py-1 rounded mt-1 block">
                  doi:"10.1038/nature12373"
                </code>
              </div>
            </div>
          </div>
        </div>
      )
    },
    {
      id: 'phrases',
      title: 'Exact Phrases',
      icon: <Lightbulb className="h-4 w-4" />,
      content: (
        <div className="space-y-4">
          <div className="p-4 bg-muted rounded-lg">
            <p className="font-medium mb-2">Use quotes for exact phrase matching:</p>
            <div className="space-y-2">
              <div>
                <code className="text-sm bg-background px-2 py-1 rounded">
                  "artificial intelligence"
                </code>
                <p className="text-xs text-muted-foreground mt-1">
                  Finds papers containing the exact phrase "artificial intelligence"
                </p>
              </div>
              <div>
                <code className="text-sm bg-background px-2 py-1 rounded">
                  "machine learning" AND "deep learning"
                </code>
                <p className="text-xs text-muted-foreground mt-1">
                  Finds papers containing both exact phrases
                </p>
              </div>
            </div>
          </div>
          
          <div className="p-4 bg-muted rounded-lg">
            <p className="font-medium mb-2">Without quotes (keyword search):</p>
            <div className="space-y-2">
              <div>
                <code className="text-sm bg-background px-2 py-1 rounded">
                  artificial intelligence
                </code>
                <p className="text-xs text-muted-foreground mt-1">
                  Finds papers containing "artificial" AND "intelligence" anywhere
                </p>
              </div>
            </div>
          </div>
        </div>
      )
    },
    {
      id: 'filters',
      title: 'Search Filters',
      icon: <HelpCircle className="h-4 w-4" />,
      content: (
        <div className="space-y-4">
          <div className="grid gap-3">
            <div>
              <p className="font-medium">Publication Year</p>
              <p className="text-sm text-muted-foreground mb-2">Filter by year range</p>
              <div className="flex gap-2">
                <code className="text-xs bg-muted px-2 py-1 rounded">2020..2024</code>
                <code className="text-xs bg-muted px-2 py-1 rounded">year:2023</code>
              </div>
            </div>
            
            <div>
              <p className="font-medium">Document Type</p>
              <p className="text-sm text-muted-foreground mb-2">Filter by paper type</p>
              <div className="flex flex-wrap gap-1">
                <Badge variant="outline" className="text-xs">Article</Badge>
                <Badge variant="outline" className="text-xs">Review</Badge>
                <Badge variant="outline" className="text-xs">Preprint</Badge>
                <Badge variant="outline" className="text-xs">Conference</Badge>
              </div>
            </div>
            
            <div>
              <p className="font-medium">Open Access</p>
              <p className="text-sm text-muted-foreground mb-2">Filter for open access papers</p>
              <div className="flex gap-2">
                <Badge variant="outline" className="text-xs">Open Access Only</Badge>
                <Badge variant="outline" className="text-xs">Has PDF</Badge>
              </div>
            </div>
            
            <div>
              <p className="font-medium">Data Sources</p>
              <p className="text-sm text-muted-foreground mb-2">Search specific databases</p>
              <div className="flex flex-wrap gap-1">
                <Badge variant="outline" className="text-xs">arXiv</Badge>
                <Badge variant="outline" className="text-xs">CORE</Badge>
                <Badge variant="outline" className="text-xs">Europe PMC</Badge>
                <Badge variant="outline" className="text-xs">NCBI</Badge>
                <Badge variant="outline" className="text-xs">OpenAIRE</Badge>
                <Badge variant="outline" className="text-xs">DOAJ</Badge>
              </div>
            </div>
          </div>
        </div>
      )
    }
  ];

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HelpCircle className="h-5 w-5" />
          Search Help
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Learn how to use advanced search features effectively
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {helpSections.map((section) => (
          <div key={section.id} className="border rounded-lg">
            <Button
              variant="ghost"
              className="w-full justify-between p-4 h-auto"
              onClick={() => toggleSection(section.id)}
            >
              <div className="flex items-center gap-3">
                {section.icon}
                <span className="font-medium">{section.title}</span>
              </div>
              {expandedSection === section.id ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </Button>
            
            {expandedSection === section.id && (
              <div className="px-4 pb-4 border-t">
                {section.content}
              </div>
            )}
          </div>
        ))}
        
        <div className="mt-6 p-4 bg-muted rounded-lg">
          <h4 className="font-medium mb-2">Quick Tips</h4>
          <ul className="text-sm text-muted-foreground space-y-1">
            <li>• Start with simple keywords and add complexity gradually</li>
            <li>• Use field-specific searches for more precise results</li>
            <li>• Combine multiple search strategies for comprehensive coverage</li>
            <li>• Use filters to narrow down results by year, type, or source</li>
            <li>• Try different synonyms and related terms if results are limited</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
