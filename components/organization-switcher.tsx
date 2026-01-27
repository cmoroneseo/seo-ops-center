'use client'

import * as React from 'react'
import { Check, ChevronsUpDown, PlusCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
    CommandSeparator,
} from '@/components/ui/command'
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/components/ui/popover'
import { useOrganization } from '@/components/providers/organization-provider'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { createClient } from '@/lib/supabase/client'

export function OrganizationSwitcher({ className }: { className?: string }) {
    const { organization, memberships, setOrganization } = useOrganization()
    const [open, setOpen] = React.useState(false)
    const [showNewOrgDialog, setShowNewOrgDialog] = React.useState(false)
    const [newOrgName, setNewOrgName] = React.useState('')
    const [isLoading, setIsLoading] = React.useState(false)
    const supabase = createClient()

    const createOrganization = async () => {
        if (!newOrgName.trim()) return
        if (!supabase) return
        setIsLoading(true)
        try {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return

            // 1. Create Org
            const slug = newOrgName.toLowerCase().replace(/[^a-z0-9]/g, '-')
            const { data: org, error: orgError } = await supabase
                .from('organizations')
                .insert({ name: newOrgName, slug })
                .select()
                .single()

            if (orgError) throw orgError

            // 2. Create Membership
            const { error: memberError } = await supabase
                .from('organization_members')
                .insert({
                    organization_id: org.id,
                    user_id: user.id,
                    role: 'owner'
                })

            if (memberError) throw memberError

            // Reload page to refresh context (simple way)
            window.location.reload()
        } catch (error) {
            console.error('Error creating org:', error)
        } finally {
            setIsLoading(false)
            setShowNewOrgDialog(false)
        }
    }

    return (
        <Dialog open={showNewOrgDialog} onOpenChange={setShowNewOrgDialog}>
            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                    <Button
                        variant="outline"
                        role="combobox"
                        aria-expanded={open}
                        aria-label="Select a team"
                        className={cn("w-[200px] justify-between", className)}
                    >
                        {organization?.name || "Select Organization"}
                        <ChevronsUpDown className="ml-auto h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[200px] p-0">
                    <Command>
                        <CommandList>
                            <CommandInput placeholder="Search organization..." />
                            <CommandEmpty>No organization found.</CommandEmpty>
                            <CommandGroup heading="Organizations">
                                {memberships.map((member) => {
                                    if (!member.organization) return null
                                    return (
                                        <CommandItem
                                            key={member.organization.id}
                                            onSelect={() => {
                                                if (member.organization) {
                                                    setOrganization(member.organization)
                                                    setOpen(false)
                                                }
                                            }}
                                            className="text-sm"
                                        >
                                            {member.organization.name}
                                            <Check
                                                className={cn(
                                                    "ml-auto h-4 w-4",
                                                    organization?.id === member.organization.id
                                                        ? "opacity-100"
                                                        : "opacity-0"
                                                )}
                                            />
                                        </CommandItem>
                                    )
                                })}
                            </CommandGroup>
                        </CommandList>
                        <CommandSeparator />
                        <CommandList>
                            <CommandGroup>
                                <DialogTrigger asChild>
                                    <CommandItem
                                        onSelect={() => {
                                            setOpen(false)
                                            setShowNewOrgDialog(true)
                                        }}
                                    >
                                        <PlusCircle className="mr-2 h-5 w-5" />
                                        Create Organization
                                    </CommandItem>
                                </DialogTrigger>
                            </CommandGroup>
                        </CommandList>
                    </Command>
                </PopoverContent>
            </Popover>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Create Organization</DialogTitle>
                    <DialogDescription>
                        Add a new organization to manage clients and projects.
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-2 pb-4">
                    <div className="space-y-2">
                        <Label htmlFor="name">Organization Name</Label>
                        <Input
                            id="name"
                            placeholder="Acme Inc."
                            value={newOrgName}
                            onChange={(e) => setNewOrgName(e.target.value)}
                        />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => setShowNewOrgDialog(false)}>Cancel</Button>
                    <Button onClick={createOrganization} disabled={isLoading}>
                        {isLoading ? 'Creating...' : 'Create'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
